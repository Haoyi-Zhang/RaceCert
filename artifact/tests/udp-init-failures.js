'use strict';
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');

async function testUdpInitializationCleanup(profile) {
  const source = fs.readFileSync(path.join(__dirname, '../udp-transport.js'), 'utf8');
  let checked = 0;
  for (const fault of [{ bind: 1 }, { bind: 2 }, { bind: 3 }, { create: 2 }, { create: 3 }]) {
    const sockets = [];
    let attempts = 0;
    const dgram = {
      createSocket() {
        attempts += 1;
        if (attempts === fault.create) throw new Error('Injected socket creation failure');
        const index = attempts;
        const socket = new EventEmitter();
        socket.bound = false; socket.closeAttempted = false;
        socket.bind = (_port, address, ready) => {
          assert.equal(address, '127.0.0.1');
          setImmediate(() => {
            if (index === fault.bind) socket.emit('error', new Error('Injected bind failure'));
            else { socket.bound = true; ready(); }
          });
        };
        socket.address = () => ({ address: '127.0.0.1', port: 30000 + index });
        socket.close = callback => {
          socket.closeAttempted = true;
          if (!socket.bound) { const error = new Error('Socket not running'); error.code = 'ERR_SOCKET_DGRAM_NOT_RUNNING'; throw error; }
          socket.bound = false;
          setImmediate(callback);
        };
        socket.send = () => { throw new Error('Unexpected send in initialization-fault test'); };
        sockets.push(socket);
        return socket;
      },
    };
    const module = { exports: {} };
    vm.runInNewContext(source, {
      require: name => { assert.equal(name, 'node:dgram'); return dgram; },
      module, exports: module.exports, process, Buffer, setTimeout, clearTimeout,
    }, { filename: 'udp-transport-mocked-initialization.js' });
    await assert.rejects(module.exports.runLiveCapture(profile), /Injected/);
    assert.ok(sockets.length > 0);
    assert.ok(sockets.every(socket => socket.closeAttempted), 'partial initialization skipped a cleanup attempt');
    assert.ok(sockets.every(socket => !socket.bound), 'bound socket survived initialization failure');
    checked += 1;
  }
  return checked;
}

async function testUdpRuntimeCleanup(profile) {
  const source = fs.readFileSync(path.join(__dirname, '../udp-transport.js'), 'utf8');
  let checked = 0;
  for (const fault of ['socket-event', 'relay-send']) {
    const sockets = [];
    let injected = false;
    const unhandled = [];
    const onUnhandled = reason => unhandled.push(reason);
    process.on('unhandledRejection', onUnhandled);
    const dgram = {
      createSocket() {
        const index = sockets.length;
        const socket = new EventEmitter();
        socket.bound = false; socket.closeAttempted = false;
        socket.bind = (_port, address, ready) => {
          assert.equal(address, '127.0.0.1');
          setImmediate(() => { socket.bound = true; ready(); });
        };
        socket.address = () => ({ address: '127.0.0.1', port: 31000 + index });
        socket.close = callback => {
          socket.closeAttempted = true;
          socket.bound = false;
          setImmediate(callback);
        };
        socket.send = (payload, _port, address, callback) => {
          assert.equal(address, '127.0.0.1');
          setImmediate(() => {
            if (!injected && fault === 'socket-event' && index === 0) {
              injected = true;
              sockets[2].emit('error', new Error('Injected post-bind socket failure'));
              callback();
            } else if (fault === 'relay-send' && index === 1) {
              injected = true;
              callback(new Error('Injected relay-forward send failure'));
            } else {
              callback();
              if (index === 0) sockets[1].emit('message', Buffer.from(payload));
              if (index === 1) sockets[2].emit('message', Buffer.from(payload));
            }
          });
        };
        sockets.push(socket);
        return socket;
      },
    };
    const module = { exports: {} };
    vm.runInNewContext(source, {
      require: name => { assert.equal(name, 'node:dgram'); return dgram; },
      module, exports: module.exports, process, Buffer, setTimeout, clearTimeout,
    }, { filename: 'udp-transport-mocked-runtime.js' });
    const input = {
      ...profile, prelude: undefined, relayOrder: undefined,
      deadlineMs: '10', lateGraceMs: '0', sendGapMs: '0',
      arrivalBudgetMs: '100', closeAfterRouted: true,
      pathA: { delayMs: '0', drop: false }, pathB: { delayMs: '0', drop: false },
    };
    try {
      await assert.rejects(module.exports.runLiveCapture(input), /Injected/);
      await new Promise(resolve => setTimeout(resolve, 20));
      assert.equal(injected, true, 'fault branch was not exercised');
      assert.equal(sockets.length, 3);
      assert.ok(sockets.every(socket => socket.closeAttempted && !socket.bound), 'runtime fault left a bound socket');
      assert.equal(unhandled.length, 0, 'relay promise rejection escaped its handler');
      checked += 1;
    } finally {
      process.removeListener('unhandledRejection', onUnhandled);
    }
  }
  return checked;
}

module.exports = { testUdpInitializationCleanup, testUdpRuntimeCleanup };
