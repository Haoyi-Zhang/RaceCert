'use strict';

const dgram = require('node:dgram');

function integerMilliseconds(value, label) {
  if (typeof value !== 'string' || !/^\d+$/.test(value)) throw new Error(`${label} must be an integer millisecond string`);
  const number = Number(value);
  if (!Number.isSafeInteger(number) || number < 0 || number > 2000) throw new Error(`${label} is outside the demo limit`);
  return number;
}

function clockProject(realUs, clock) {
  const ppm = BigInt(clock.ppm);
  const offset = BigInt(clock.offsetUs);
  return ((realUs * (1_000_000n + ppm)) / 1_000_000n + offset).toString();
}

function delay(ms) { return new Promise((resolve) => setTimeout(resolve, ms)); }
function bind(socket) {
  return new Promise((resolve, reject) => {
    socket.once('error', reject);
    socket.bind(0, '127.0.0.1', () => {
      socket.removeListener('error', reject);
      resolve(socket.address());
    });
  });
}

function send(socket, payload, port) {
  return new Promise((resolve, reject) => socket.send(Buffer.from(payload), port, '127.0.0.1', (error) => error ? reject(error) : resolve()));
}

async function runLiveCapture(profile) {
  if (!profile || typeof profile.scenarioId !== 'string') throw new Error('live profile is missing scenarioId');
  const deadlineMs = integerMilliseconds(profile.deadlineMs, 'deadlineMs');
  const lateGraceMs = integerMilliseconds(profile.lateGraceMs, 'lateGraceMs');
  const sendGapMs = integerMilliseconds(profile.sendGapMs, 'sendGapMs');
  const recoveryAfterMs = profile.recoveryAfterMs ? integerMilliseconds(profile.recoveryAfterMs, 'recoveryAfterMs') : 0;
  const arrivalBudgetMs = profile.arrivalBudgetMs ? integerMilliseconds(profile.arrivalBudgetMs, 'arrivalBudgetMs') : deadlineMs;
  const closeAfterRouted = profile.closeAfterRouted === true;
  const route = {
    A: { delayMs: integerMilliseconds(profile.pathA.delayMs, 'pathA.delayMs'), drop: profile.pathA.drop === true },
    B: { delayMs: integerMilliseconds(profile.pathB.delayMs, 'pathB.delayMs'), drop: profile.pathB.drop === true },
  };
  const relayOrder = profile.relayOrder === undefined ? null : profile.relayOrder;
  if (relayOrder !== null && (
    !Array.isArray(relayOrder) || relayOrder.length !== 2 ||
    new Set(relayOrder).size !== 2 || !relayOrder.includes('A') || !relayOrder.includes('B')
  )) throw new Error('relayOrder must be a permutation of [A,B]');
  const sockets = [];
  let captureError = null;
  function captureFailed(error) {
    if (!captureError) captureError = error;
  }
  function assertCaptureHealthy() {
    if (captureError) throw captureError;
  }
  function makeSocket() {
    const socket = dgram.createSocket('udp4');
    sockets.push(socket);
    socket.on('error', captureFailed);
    return socket;
  }
  try {
  const sender = makeSocket();
  const relay = makeSocket();
  const receiver = makeSocket();
  const senderAddress = await bind(sender);
  const relayAddress = await bind(relay);
  const receiverAddress = await bind(receiver);
  const origin = process.hrtime.bigint();
  const relativeUs = () => (process.hrtime.bigint() - origin) / 1000n;
  const eventLog = [];
  const selectedRound = profile.prelude?.dropBoth ? 'recovery' : 'main';
  const sentTimes = {};
  const arrivalTimes = {};
  let closed = false;
  let closeTime = null;
  const pending = [];
  function trackForward(promise) {
    pending.push(promise.catch(captureFailed));
  }
  const orderedMessages = new Map();
  let orderedForwardStarted = false;

  function log(type, data = {}) {
    eventLog.push({ sequence: String(eventLog.length + 1), monotonicUs: relativeUs().toString(), type, ...data });
  }

  async function waitForRoutedArrivals() {
    const expected = Object.entries(route).filter(([, value]) => !value.drop).map(([path]) => path);
    const expires = Date.now() + arrivalBudgetMs;
    while (!expected.every((path) => arrivalTimes[path] !== undefined)) {
      assertCaptureHealthy();
      if (Date.now() >= expires) throw new Error(`routed arrivals exceeded ${arrivalBudgetMs} ms capture budget`);
      await delay(1);
    }
  }

  receiver.on('message', (message) => {
    try {
    const parsed = JSON.parse(message.toString('utf8'));
    const at = relativeUs();
    const status = closed ? 'late-after-close' : 'accepted-before-close';
    log('receiver-capture', { round: parsed.round, path: parsed.path, status });
    if (parsed.round === selectedRound && !closed && arrivalTimes[parsed.path] === undefined) arrivalTimes[parsed.path] = at;
    } catch (error) { captureFailed(error); }
  });

  relay.on('message', (message) => {
    try {
    const parsed = JSON.parse(message.toString('utf8'));
    log('relay-capture', { round: parsed.round, path: parsed.path });
    const deliberatePreludeDrop = parsed.round === 'prelude' && profile.prelude?.dropBoth;
    if (deliberatePreludeDrop || route[parsed.path].drop) {
      log('relay-drop', { round: parsed.round, path: parsed.path, reason: deliberatePreludeDrop ? 'disconnect-prelude' : 'profile-drop' });
      return;
    }
    if (relayOrder !== null && parsed.round === selectedRound) {
      orderedMessages.set(parsed.path, Buffer.from(message));
      if (!orderedForwardStarted && relayOrder.every((path) => orderedMessages.has(path))) {
        orderedForwardStarted = true;
        const forward = (async () => {
          let elapsedDelay = 0;
          for (const path of relayOrder) {
            const targetDelay = route[path].delayMs;
            await delay(Math.max(0, targetDelay - elapsedDelay));
            elapsedDelay = Math.max(elapsedDelay, targetDelay);
            await send(relay, orderedMessages.get(path), receiverAddress.port);
            log('relay-forward', {
              round: parsed.round,
              path,
              delayMs: String(targetDelay),
              ordered: 'true',
            });
          }
        })();
        trackForward(forward);
      }
      return;
    }
    const forward = delay(route[parsed.path].delayMs).then(async () => {
      await send(relay, message, receiverAddress.port);
      log('relay-forward', { round: parsed.round, path: parsed.path, delayMs: String(route[parsed.path].delayMs) });
    });
    trackForward(forward);
    } catch (error) { captureFailed(error); }
  });

  async function emitRound(round) {
    for (const path of ['A', 'B']) {
      if (path === 'B') await delay(sendGapMs);
      assertCaptureHealthy();
      const payload = JSON.stringify({ scenarioId: profile.scenarioId, round, path });
      if (round === selectedRound) sentTimes[path] = relativeUs();
      await send(sender, payload, relayAddress.port);
      log('sender-capture', { round, path });
    }
  }

  {
    if (profile.prelude?.dropBoth) {
      await emitRound('prelude');
      await delay(recoveryAfterMs);
      log('link-recovery', { nextRound: 'recovery' });
      await emitRound('recovery');
    } else {
      await emitRound('main');
    }
    if (closeAfterRouted) await waitForRoutedArrivals();
    else await delay(deadlineMs);
    assertCaptureHealthy();
    closed = true;
    closeTime = relativeUs();
    log('receiver-close', { deadlineMs: String(deadlineMs) });
    await delay(lateGraceMs);
    await Promise.all(pending);
    assertCaptureHealthy();
  }

  if (sentTimes.A === undefined || sentTimes.B === undefined || closeTime === null) throw new Error('capture did not record the selected race');
  const senderClock = { ppm: '137', offsetUs: '100000' };
  const receiverClock = { ppm: '-83', offsetUs: '700000' };
  const observations = {
    sendAUs: clockProject(sentTimes.A, senderClock),
    sendBUs: clockProject(sentTimes.B, senderClock),
    recvAUs: arrivalTimes.A === undefined ? null : clockProject(arrivalTimes.A, receiverClock),
    recvBUs: arrivalTimes.B === undefined ? null : clockProject(arrivalTimes.B, receiverClock),
    closeUs: clockProject(closeTime, receiverClock),
  };
  const acceptedOrder = eventLog.filter((event) => event.type === 'receiver-capture' && event.status === 'accepted-before-close' && event.round === selectedRound).map((event) => event.path);
  const capture = {
    kind: 'localhost-udp-capture-v2',
    deterministic: false,
    protocol: 'IPv4 UDP',
    bindAddress: '127.0.0.1',
    socketBindings: Object.fromEntries([['sender', senderAddress], ['relay', relayAddress], ['receiver', receiverAddress]].map(([role, address]) => [role, { address: address.address, port: String(address.port) }])),
    selectedRound,
    impairment: {
      deadlineMs: String(deadlineMs),
      closePolicy: closeAfterRouted ? 'after-routed-arrivals' : 'fixed-deadline',
      arrivalBudgetMs: String(arrivalBudgetMs),
      sendGapMs: String(sendGapMs),
      pathA: { delayMs: String(route.A.delayMs), drop: route.A.drop },
      pathB: { delayMs: String(route.B.delayMs), drop: route.B.drop },
      relayOrder,
      recoveryAfterMs: String(recoveryAfterMs),
    },
    senderClock, receiverClock,
    observations,
    acceptedOrder,
    events: eventLog,
  };
  return {
    scenarioId: profile.scenarioId,
    source: 'live-udp',
    ...observations,
    epsilonSenderPpm: '200', epsilonReceiverPpm: '200', etaSenderUs: '2', etaReceiverUs: '2', marginUs: '500',
    capture,
  };
  } finally {
    await Promise.all(sockets.map(socket => new Promise((resolve, reject) => {
      try { socket.close(resolve); }
      catch (error) {
        if (error.code === 'ERR_SOCKET_DGRAM_NOT_RUNNING') resolve();
        else reject(error);
      }
    })));
    assertCaptureHealthy();
  }
}

module.exports = { runLiveCapture };
