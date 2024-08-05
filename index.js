'use strict';

import EventEmitter from 'events'
import * as devtools from './lib/devtools.js'
import { Chrome } from './lib/chrome.js'


export const CDP = (options, callback) => {
    if (typeof options === 'function') {
        callback = options;
        options = undefined;
    }
    const notifier = new EventEmitter();
    if (typeof callback === 'function') {
        // allow to register the error callback later
        process.nextTick(() => {
            new Chrome(options, notifier);
        });
        return notifier.once('connect', callback);
    } else {
        return new Promise((fulfill, reject) => {
            notifier.once('connect', fulfill);
            notifier.once('error', reject);
            new Chrome(options, notifier);
        });
    }
}

export const Protocol = devtools.Protocol
export const List = devtools.List
export const New = devtools.New
export const Activate = devtools.Activate
export const Close = devtools.Close
export const Version = devtools.Version