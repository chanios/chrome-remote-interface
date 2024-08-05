import localDescriptor from './protocol.json' with { type: 'json' }
import { PORT, HOST } from './defaults.js';

async function devToolsInterface(path, options) {
    const url = new URL(path, `${options.secure?'https':'http'}://${options.host || HOST}:${options.port || PORT}`);
    const requestOptions = {
        method: options.method,
        headers: options.headers || {}
    };

    if (options.useHostName) {
        url.hostname = options.useHostName;
    }
    
    const response = await fetch(options.alterPath?options.alterPath(url.toString()):url.toString(), requestOptions);
    if (!response.ok) {
        throw new Error(`HTTP error! status: ${response.status}`);
    }

    return response.json();
}

async function protocolHandler(options) {
    if (options.local) {
        return localDescriptor;
    } else {
        return await devToolsInterface('/json/protocol', options);
    }
}

async function listHandler(options) {
    return await devToolsInterface('/json/list', options);
}

async function newHandler(options) {
    let path = '/json/new';
    if (options.url) {
        path += `?${options.url}`;
    }
    options.method = options.method || 'PUT';
    return await devToolsInterface(path, options);
}

async function activateHandler(options) {
    await devToolsInterface(`/json/activate/${options.id}`, options);
}

async function closeHandler(options) {
    await devToolsInterface(`/json/close/${options.id}`, options);
}

async function versionHandler(options) {
    return await devToolsInterface('/json/version', options);
}

export const Protocol = protocolHandler;
export const List = listHandler;
export const New = newHandler;
export const Activate = activateHandler;
export const Close = closeHandler;
export const Version = versionHandler;
