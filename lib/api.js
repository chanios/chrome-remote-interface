'use strict';

function convertArrayToObject(array) {
    const result = {};
    array.forEach((item) => {
        const { name, ...rest } = item;
        result[name] = rest;
    });
    return result;
}

function decorateWithCategory(target, category, source) {
    target.category = category;
    Object.keys(source).forEach((key) => {
        if (key === 'name') return;

        if (category === 'type' && key === 'properties' || key === 'parameters') {
            target[key] = convertArrayToObject(source[key]);
        } else {
            target[key] = source[key];
        }
    });
}

function createCommandHandler(chrome, domainName, command) {
    const commandFullName = `${domainName}.${command.name}`;
    const handler = (params, sessionId, callback) => {
        return chrome.send(commandFullName, params, sessionId, callback);
    };
    decorateWithCategory(handler, 'command', command);
    chrome[commandFullName] = chrome[domainName][command.name] = handler;
}

function createEventHandler(chrome, domainName, event) {
    const eventFullName = `${domainName}.${event.name}`;
    const handler = (sessionId, eventHandler) => {
        if (typeof sessionId === 'function') {
            eventHandler = sessionId;
            sessionId = undefined;
        }
        const rawEventName = sessionId ? `${eventFullName}.${sessionId}` : eventFullName;
        if (typeof eventHandler === 'function') {
            chrome.on(rawEventName, eventHandler);
            return () => chrome.removeListener(rawEventName, eventHandler);
        } else {
            return new Promise((resolve) => {
                chrome.once(rawEventName, resolve);
            });
        }
    };
    decorateWithCategory(handler, 'event', event);
    chrome[eventFullName] = chrome[domainName][event.name] = handler;
}

function createTypeHelper(chrome, domainName, type) {
    const typeFullName = `${domainName}.${type.id}`;
    const helper = {};
    decorateWithCategory(helper, 'type', type);
    chrome[typeFullName] = chrome[domainName][type.id] = helper;
}

function initializeProtocol(chrome, protocol) {
    chrome.protocol = protocol;
    protocol.domains.forEach((domain) => {
        const domainName = domain.domain;
        chrome[domainName] = {};

        (domain.commands || []).forEach((command) => {
            createCommandHandler(chrome, domainName, command);
        });

        (domain.events || []).forEach((event) => {
            createEventHandler(chrome, domainName, event);
        });

        (domain.types || []).forEach((type) => {
            createTypeHelper(chrome, domainName, type);
        });

        chrome[domainName].on = (eventName, handler) => {
            return chrome[domainName][eventName](handler);
        };
    });
}

export { initializeProtocol };
