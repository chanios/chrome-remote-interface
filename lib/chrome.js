'use strict';

import { EventEmitter } from 'events';
import util from 'util';
import WebSocket from 'ws';

import { initializeProtocol } from './api.js';
import * as defaults from './defaults.js';
import * as devtools from './devtools.js';

class ProtocolError extends Error {
    constructor(request, response) {
        let { message } = response;
        if (response.data) {
            message += ` (${response.data})`;
        }
        super(message);
        this.request = request;
        this.response = response;
    }
}

class Chrome extends EventEmitter {
    constructor(options, notifier) {
        super();
        this._initializeOptions(options);
        this._initializeLocals(notifier);
        this._start();
    }

    // avoid misinterpreting protocol's members as custom util.inspect functions
    inspect(depth, options) {
        options.customInspect = false;
        return util.inspect(this, options);
    }

    send(method, ...args) {
        const [params, sessionId, callback] = this._parseSendArguments(args);

        if (typeof callback === 'function') {
            this._enqueueCommand(method, params, sessionId, callback);
        } else {
            return new Promise((fulfill, reject) => {
                this._enqueueCommand(method, params, sessionId, (error, response) => {
                    if (error) {
                        const request = { method, params, sessionId };
                        reject(
                            error instanceof Error
                                ? error // low-level WebSocket error
                                : new ProtocolError(request, response)
                        );
                    } else {
                        fulfill(response);
                    }
                });
            });
        }
    }

    close(callback) {
        const closeWebSocket = (cb) => {
            if (this._ws.readyState === WebSocket.CLOSED) {
                cb();
            } else {
                this._ws.removeAllListeners('close');
                this._ws.once('close', () => {
                    this._ws.removeAllListeners();
                    this._handleConnectionClose();
                    cb();
                });
                this._ws.close();
            }
        };

        if (typeof callback === 'function') {
            closeWebSocket(callback);
        } else {
            return new Promise(closeWebSocket);
        }
    }

    _initializeOptions(options = {}) {
        const defaultTarget = (targets) => {
            let backup;
            let target = targets.find(target => {
                if (target.webSocketDebuggerUrl) {
                    backup = backup || target;
                    return target.type === 'page';
                }
                return false;
            });
            return target || backup || (() => { throw new Error('No inspectable targets') })();
        };

        this.host = options.host || defaults.HOST;
        this.port = options.port || defaults.PORT;
        this.secure = !!options.secure;
        this.useHostName = !!options.useHostName;
        this.alterPath = options.alterPath || (path => path);
        this.protocol = options.protocol;
        this.local = !!options.local;
        this.target = options.target || defaultTarget;
    }

    _initializeLocals(notifier) {
        this._notifier = notifier;
        this._callbacks = {};
        this._nextCommandId = 1;
        this.webSocketUrl = undefined;
    }

    _parseSendArguments(args) {
        const params = args.find(x => typeof x === 'object');
        const sessionId = args.find(x => typeof x === 'string');
        const callback = args.find(x => typeof x === 'function');
        return [params, sessionId, callback];
    }

    async _start() {
        const options = {
            host: this.host,
            port: this.port,
            secure: this.secure,
            useHostName: this.useHostName,
            alterPath: this.alterPath
        };
        try {
            const url = new URL(await this._fetchDebuggerURL(options));
            options.host = url.hostname;
            options.port = url.port || options.port;
            this.webSocketUrl = options.alterPath(`ws://${options.host}:${options.port}${url.pathname}`)
            
            const protocol = await this._fetchProtocol(options);
            initializeProtocol(this, protocol);

            await this._connectToWebSocket();

            process.nextTick(() => {
                this._notifier.emit('connect', this);
            });
        } catch (err) {
            this._notifier.emit('error', err);
        }
    }

    async _fetchDebuggerURL(options) {
        switch (typeof this.target) {
            case 'string': {
                let idOrUrl = this.target;
                if (idOrUrl.startsWith('/')) {
                    idOrUrl = `ws://${this.host}:${this.port}${idOrUrl}`;
                }
                if (/^wss?:/i.test(idOrUrl)) {
                    return idOrUrl;
                } else {
                    const targets = await devtools.List(options);
                    const target = targets.find(target => target.id === idOrUrl);
                    return target.webSocketDebuggerUrl;
                }
            }
            case 'object': {
                return this.target.webSocketDebuggerUrl;
            }
            case 'function': {
                const targets = await devtools.List(options);
                const result = this.target(targets);
                const target = typeof result === 'number' ? targets[result] : result;
                return target.webSocketDebuggerUrl;
            }
            default:
                throw new Error(`Invalid target argument "${this.target}"`);
        }
    }


    async _fetchProtocol(options) {
        if (this.protocol) {
            return this.protocol;
        } else {
            options.local = this.local;
            return await devtools.Protocol(options);
        }
    }

    _connectToWebSocket() {
        return new Promise((fulfill, reject) => {
            try {
                if (this.secure) {
                    this.webSocketUrl = this.webSocketUrl.replace(/^ws:/i, 'wss:');
                }
                this._ws = new WebSocket(this.webSocketUrl, [], {
                    maxPayload: 256 * 1024 * 1024,
                    perMessageDeflate: false,
                    followRedirects: true,
                });
            } catch (err) {
                reject(err);
                return;
            }

            this._ws.on('open', fulfill);
            this._ws.on('message', data => this._handleMessage(JSON.parse(data)));
            this._ws.on('close', () => {
                this._handleConnectionClose();
                this.emit('disconnect');
            });
            this._ws.on('error', reject);
        });
    }

    _handleConnectionClose() {
        const err = new Error('WebSocket connection closed');
        Object.values(this._callbacks).forEach(callback => callback(err));
        this._callbacks = {};
    }

    _handleMessage(message) {
        if (message.id) {
            const callback = this._callbacks[message.id];
            if (!callback) return;

            if (message.error) {
                callback(true, message.error);
            } else {
                callback(false, message.result || {});
            }

            delete this._callbacks[message.id];
            if (Object.keys(this._callbacks).length === 0) {
                this.emit('ready');
            }
        } else if (message.method) {
            const { method, params, sessionId } = message;
            this.emit('event', message);
            this.emit(method, params, sessionId);
            this.emit(`${method}.${sessionId}`, params, sessionId);
        }
    }

    _enqueueCommand(method, params, sessionId, callback) {
        const id = this._nextCommandId++;
        const message = { id, method, sessionId, params: params || {} };

        this._ws.send(JSON.stringify(message), err => {
            if (err) {
                callback(err);
            } else {
                this._callbacks[id] = callback;
            }
        });
    }
}

export { Chrome }
