'use strict';

// RaceCert producer. Every model calculation uses BigInt-backed rational
// arithmetic. Schema integers must arrive as decimal strings; JavaScript
// Number values are rejected before any semantic calculation or hashing.

const crypto = require('node:crypto');

const ONE_MILLION = 1_000_000n;

function absBig(value) { return value < 0n ? -value : value; }
function gcd(a, b) {
  a = absBig(a); b = absBig(b);
  while (b !== 0n) [a, b] = [b, a % b];
  return a || 1n;
}

class Rat {
  constructor(numerator, denominator = 1n) {
    let n = BigInt(numerator);
    let d = BigInt(denominator);
    if (d === 0n) throw new Error('zero rational denominator');
    if (d < 0n) { n = -n; d = -d; }
    const divisor = gcd(n, d);
    this.n = n / divisor;
    this.d = d / divisor;
    Object.freeze(this);
  }
  add(other) { other = Rat.from(other); return new Rat(this.n * other.d + other.n * this.d, this.d * other.d); }
  sub(other) { other = Rat.from(other); return new Rat(this.n * other.d - other.n * this.d, this.d * other.d); }
  mul(other) { other = Rat.from(other); return new Rat(this.n * other.n, this.d * other.d); }
  div(other) { other = Rat.from(other); if (other.n === 0n) throw new Error('divide by zero'); return new Rat(this.n * other.d, this.d * other.n); }
  neg() { return new Rat(-this.n, this.d); }
  abs() { return new Rat(absBig(this.n), this.d); }
  cmp(other) { other = Rat.from(other); const delta = this.n * other.d - other.n * this.d; return delta < 0n ? -1 : delta > 0n ? 1 : 0; }
  eq(other) { return this.cmp(other) === 0; }
  toJSON() { return { n: this.n.toString(), d: this.d.toString() }; }
  static from(value) {
    if (value instanceof Rat) return value;
    if (typeof value === 'bigint') return new Rat(value);
    if (typeof value === 'string' && /^-?\d+$/.test(value)) return new Rat(BigInt(value));
    if (value && typeof value === 'object' && typeof value.n === 'string' && typeof value.d === 'string') return new Rat(BigInt(value.n), BigInt(value.d));
    throw new Error(`not an exact rational: ${String(value)}`);
  }
}

const ZERO = new Rat(0n);
const ONE = new Rat(1n);
const TWO = new Rat(2n);
function minRat(...values) { return values.reduce((a, b) => a.cmp(b) <= 0 ? a : b); }
function maxRat(...values) { return values.reduce((a, b) => a.cmp(b) >= 0 ? a : b); }
function midpoint(a, b) { return a.add(b).div(TWO); }

function integer(value, name) {
  if (typeof value === 'bigint') return value;
  if (typeof value === 'string' && /^-?\d+$/.test(value)) return BigInt(value);
  throw new Error(`${name} must be a decimal integer string`);
}

function canonical(value) {
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  if (value && typeof value === 'object') {
    return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonical(value[key])}`).join(',')}}`;
  }
  if (typeof value === 'number' || typeof value === 'bigint' || value === undefined) throw new Error('canonical payload contains a non-schema numeric value');
  return JSON.stringify(value);
}

function digestSemantic(value) {
  return crypto.createHash('sha256').update(canonical(value), 'utf8').digest('hex');
}

function exactInput(input) {
  const assumptions = {
    epsilonSenderPpm: integer(input.epsilonSenderPpm, 'epsilonSenderPpm'),
    epsilonReceiverPpm: integer(input.epsilonReceiverPpm, 'epsilonReceiverPpm'),
    etaSenderUs: integer(input.etaSenderUs, 'etaSenderUs'),
    etaReceiverUs: integer(input.etaReceiverUs, 'etaReceiverUs'),
    marginUs: integer(input.marginUs, 'marginUs'),
  };
  for (const key of ['epsilonSenderPpm', 'epsilonReceiverPpm']) {
    if (assumptions[key] < 0n || assumptions[key] >= ONE_MILLION) throw new Error(`${key} out of range`);
  }
  for (const key of ['etaSenderUs', 'etaReceiverUs', 'marginUs']) {
    if (assumptions[key] < 0n) throw new Error(`${key} must be nonnegative`);
  }
  const observations = {
    sendAUs: integer(input.sendAUs, 'sendAUs'),
    sendBUs: integer(input.sendBUs, 'sendBUs'),
    recvAUs: input.recvAUs === null || input.recvAUs === undefined ? null : integer(input.recvAUs, 'recvAUs'),
    recvBUs: input.recvBUs === null || input.recvBUs === undefined ? null : integer(input.recvBUs, 'recvBUs'),
    closeUs: integer(input.closeUs, 'closeUs'),
  };
  return { assumptions, observations };
}

function serializeIntegers(object) {
  return Object.fromEntries(Object.entries(object).map(([key, value]) => [key, value === null ? null : value.toString()]));
}

function qBounds(ppm) {
  return {
    lo: new Rat(ONE_MILLION - ppm, ONE_MILLION),
    hi: new Rat(ONE_MILLION + ppm, ONE_MILLION),
  };
}

function elapsedHull(recordedDifference, ppm, perReadEta) {
  const error = 2n * perReadEta;
  const q = qBounds(ppm);
  const lowReading = new Rat(recordedDifference - error);
  const highReading = new Rat(recordedDifference + error);
  const candidates = [lowReading.div(q.lo), lowReading.div(q.hi), highReading.div(q.lo), highReading.div(q.hi)];
  return { lo: minRat(...candidates), hi: maxRat(...candidates) };
}

function subtractIntervals(left, right) {
  return { lo: left.lo.sub(right.hi), hi: left.hi.sub(right.lo) };
}

function finiteIntervalJSON(interval) {
  return {
    lo: interval.lo === null ? null : interval.lo.toJSON(),
    hi: interval.hi === null ? null : interval.hi.toJSON(),
    loClosed: 'true',
    hiClosed: 'true',
  };
}

function bounded(interval) {
  return { lo: interval.lo, hi: interval.hi };
}

function classify(interval, margin) {
  const negative = margin.neg();
  if (interval.hi !== null && interval.hi.cmp(negative) < 0) return 'force-a';
  if (interval.lo !== null && interval.lo.cmp(margin) > 0) return 'force-b';
  if (interval.lo !== null && interval.hi !== null && interval.lo.cmp(negative) >= 0 && interval.hi.cmp(margin) <= 0) return 'neutral';
  return 'ambiguous';
}

function feasibleOutcomes(interval, margin) {
  const result = [];
  const negative = margin.neg();
  if (interval.lo === null || interval.lo.cmp(negative) < 0) result.push('force-a');
  if ((interval.lo === null || interval.lo.cmp(margin) <= 0) && (interval.hi === null || interval.hi.cmp(negative) >= 0)) result.push('neutral');
  if (interval.hi === null || interval.hi.cmp(margin) > 0) result.push('force-b');
  return result;
}

function chooseTarget(interval, outcome, margin) {
  const negative = margin.neg();
  if (outcome === 'force-a') {
    if (interval.lo === null) return interval.hi !== null && interval.hi.cmp(negative) < 0 ? interval.hi : negative.sub(ONE);
    const upper = interval.hi === null ? negative : minRat(interval.hi, negative);
    return midpoint(interval.lo, upper);
  }
  if (outcome === 'force-b') {
    if (interval.hi === null) return interval.lo !== null && interval.lo.cmp(margin) > 0 ? interval.lo : margin.add(ONE);
    const lower = interval.lo === null ? margin : maxRat(interval.lo, margin);
    return midpoint(lower, interval.hi);
  }
  const low = interval.lo === null ? negative : maxRat(interval.lo, negative);
  const high = interval.hi === null ? margin : minRat(interval.hi, margin);
  if (low.cmp(ZERO) <= 0 && high.cmp(ZERO) >= 0) return ZERO;
  return midpoint(low, high);
}

function realizeElapsed(recordedDifference, ppm, perReadEta, realDifference) {
  const q = qBounds(ppm);
  const error = new Rat(2n * perReadEta);
  let feasibleQ = q;
  if (realDifference.cmp(ZERO) === 0) {
    if (new Rat(recordedDifference).abs().cmp(error) > 0) throw new Error('zero elapsed witness is infeasible');
  } else {
    const lowProduct = new Rat(recordedDifference).sub(error);
    const highProduct = new Rat(recordedDifference).add(error);
    let lowQ = lowProduct.div(realDifference);
    let highQ = highProduct.div(realDifference);
    if (lowQ.cmp(highQ) > 0) [lowQ, highQ] = [highQ, lowQ];
    feasibleQ = { lo: maxRat(q.lo, lowQ), hi: minRat(q.hi, highQ) };
    if (feasibleQ.lo.cmp(feasibleQ.hi) > 0) throw new Error('elapsed witness has no admissible rate');
  }
  const rate = midpoint(feasibleQ.lo, feasibleQ.hi);
  const elapsedError = new Rat(recordedDifference).sub(rate.mul(realDifference));
  return {
    rate,
    errorFirst: elapsedError.div(TWO),
    errorSecond: elapsedError.neg().div(TWO),
  };
}

function nonnegativeTimesFromDifference(difference) {
  return difference.cmp(ZERO) >= 0 ? { a: difference, b: ZERO } : { a: ZERO, b: difference.neg() };
}

function serializeEndpoint(endpoint) {
  return {
    rate: endpoint.rate.toJSON(),
    offsetUs: endpoint.offset.toJSON(),
    readErrorAUs: endpoint.errorA === null ? null : endpoint.errorA.toJSON(),
    readErrorBUs: endpoint.errorB === null ? null : endpoint.errorB.toJSON(),
    readErrorCloseUs: endpoint.errorClose === null ? null : endpoint.errorClose.toJSON(),
  };
}

function serializeReal(real) {
  return Object.fromEntries(Object.entries(real).map(([key, value]) => [key, value === null ? null : value.toJSON()]));
}

function assignmentJSON(outcome, sender, receiver, real) {
  return { outcome, assignment: { sender: serializeEndpoint(sender), receiver: serializeEndpoint(receiver), real: serializeReal(real) } };
}

function pairedWitness(outcome, target, assumptions, observations, sendHull, receiveHull) {
  const sendLow = maxRat(sendHull.lo, receiveHull.lo.sub(target));
  const sendHigh = minRat(sendHull.hi, receiveHull.hi.sub(target));
  if (sendLow.cmp(sendHigh) > 0) throw new Error('target is outside paired interval');
  const sendDifference = midpoint(sendLow, sendHigh);
  const receiveDifference = sendDifference.add(target);
  const senderElapsed = realizeElapsed(observations.sendAUs - observations.sendBUs, assumptions.epsilonSenderPpm, assumptions.etaSenderUs, sendDifference);
  const receiverElapsed = realizeElapsed(observations.recvAUs - observations.recvBUs, assumptions.epsilonReceiverPpm, assumptions.etaReceiverUs, receiveDifference);
  const sends = nonnegativeTimesFromDifference(sendDifference);
  const delayB = maxRat(target.neg(), ZERO).add(ONE);
  const delayA = delayB.add(target);
  const receiveA = sends.a.add(delayA);
  const receiveB = sends.b.add(delayB);
  const senderOffset = new Rat(observations.sendAUs).sub(senderElapsed.rate.mul(sends.a)).sub(senderElapsed.errorFirst);
  const receiverOffset = new Rat(observations.recvAUs).sub(receiverElapsed.rate.mul(receiveA)).sub(receiverElapsed.errorFirst);
  return assignmentJSON(outcome,
    { rate: senderElapsed.rate, offset: senderOffset, errorA: senderElapsed.errorFirst, errorB: senderElapsed.errorSecond, errorClose: null },
    { rate: receiverElapsed.rate, offset: receiverOffset, errorA: receiverElapsed.errorFirst, errorB: receiverElapsed.errorSecond, errorClose: null },
    { sendAUs: sends.a, sendBUs: sends.b, receiveAUs: receiveA, receiveBUs: receiveB, closeUs: null, delayAUs: delayA, delayBUs: delayB, delayDifferenceUs: target, completionWaitAUs: ZERO, completionWaitBUs: ZERO });
}

function onlyAWitness(outcome, target, assumptions, observations, sendHull, gapHull) {
  const sendDifference = sendHull.lo;
  const gap = minRat(gapHull.hi, ZERO);
  const waitB = gap.sub(sendDifference).sub(target);
  if (waitB.cmp(ZERO) < 0) throw new Error('negative B completion wait');
  const senderElapsed = realizeElapsed(observations.sendAUs - observations.sendBUs, assumptions.epsilonSenderPpm, assumptions.etaSenderUs, sendDifference);
  const receiverElapsed = realizeElapsed(observations.recvAUs - observations.closeUs, assumptions.epsilonReceiverPpm, assumptions.etaReceiverUs, gap);
  const sends = nonnegativeTimesFromDifference(sendDifference);
  const close = maxRat(sends.a.sub(gap), sends.b.sub(waitB), ZERO).add(ONE);
  const receiveA = close.add(gap);
  const receiveB = close.add(waitB);
  const delayA = receiveA.sub(sends.a);
  const delayB = receiveB.sub(sends.b);
  const senderOffset = new Rat(observations.sendAUs).sub(senderElapsed.rate.mul(sends.a)).sub(senderElapsed.errorFirst);
  const receiverOffset = new Rat(observations.closeUs).sub(receiverElapsed.rate.mul(close)).sub(receiverElapsed.errorSecond);
  return assignmentJSON(outcome,
    { rate: senderElapsed.rate, offset: senderOffset, errorA: senderElapsed.errorFirst, errorB: senderElapsed.errorSecond, errorClose: null },
    { rate: receiverElapsed.rate, offset: receiverOffset, errorA: receiverElapsed.errorFirst, errorB: null, errorClose: receiverElapsed.errorSecond },
    { sendAUs: sends.a, sendBUs: sends.b, receiveAUs: receiveA, receiveBUs: receiveB, closeUs: close, delayAUs: delayA, delayBUs: delayB, delayDifferenceUs: target, completionWaitAUs: ZERO, completionWaitBUs: waitB });
}

function onlyBWitness(outcome, target, assumptions, observations, sendHull, gapHull) {
  const sendDifference = sendHull.hi;
  const gap = maxRat(gapHull.lo, ZERO);
  const waitA = target.sub(gap).add(sendDifference);
  if (waitA.cmp(ZERO) < 0) throw new Error('negative A completion wait');
  const senderElapsed = realizeElapsed(observations.sendAUs - observations.sendBUs, assumptions.epsilonSenderPpm, assumptions.etaSenderUs, sendDifference);
  const receiverElapsed = realizeElapsed(observations.closeUs - observations.recvBUs, assumptions.epsilonReceiverPpm, assumptions.etaReceiverUs, gap);
  const sends = nonnegativeTimesFromDifference(sendDifference);
  const close = maxRat(sends.a.sub(waitA), sends.b.add(gap), ZERO).add(ONE);
  const receiveA = close.add(waitA);
  const receiveB = close.sub(gap);
  const delayA = receiveA.sub(sends.a);
  const delayB = receiveB.sub(sends.b);
  const senderOffset = new Rat(observations.sendAUs).sub(senderElapsed.rate.mul(sends.a)).sub(senderElapsed.errorFirst);
  const receiverOffset = new Rat(observations.closeUs).sub(receiverElapsed.rate.mul(close)).sub(receiverElapsed.errorFirst);
  return assignmentJSON(outcome,
    { rate: senderElapsed.rate, offset: senderOffset, errorA: senderElapsed.errorFirst, errorB: senderElapsed.errorSecond, errorClose: null },
    { rate: receiverElapsed.rate, offset: receiverOffset, errorA: null, errorB: receiverElapsed.errorSecond, errorClose: receiverElapsed.errorFirst },
    { sendAUs: sends.a, sendBUs: sends.b, receiveAUs: receiveA, receiveBUs: receiveB, closeUs: close, delayAUs: delayA, delayBUs: delayB, delayDifferenceUs: target, completionWaitAUs: waitA, completionWaitBUs: ZERO });
}

function noArrivalWitness(outcome, target, assumptions, observations, sendHull) {
  const sendDifference = midpoint(sendHull.lo, sendHull.hi);
  const senderElapsed = realizeElapsed(observations.sendAUs - observations.sendBUs, assumptions.epsilonSenderPpm, assumptions.etaSenderUs, sendDifference);
  const sends = nonnegativeTimesFromDifference(sendDifference);
  const arrivalDifference = sendDifference.add(target);
  const waits = nonnegativeTimesFromDifference(arrivalDifference);
  const close = maxRat(sends.a, sends.b).add(ONE);
  const receiveA = close.add(waits.a).add(ONE);
  const receiveB = close.add(waits.b).add(ONE);
  const delayA = receiveA.sub(sends.a);
  const delayB = receiveB.sub(sends.b);
  const senderOffset = new Rat(observations.sendAUs).sub(senderElapsed.rate.mul(sends.a)).sub(senderElapsed.errorFirst);
  const receiverRate = ONE;
  const receiverOffset = new Rat(observations.closeUs).sub(close);
  return assignmentJSON(outcome,
    { rate: senderElapsed.rate, offset: senderOffset, errorA: senderElapsed.errorFirst, errorB: senderElapsed.errorSecond, errorClose: null },
    { rate: receiverRate, offset: receiverOffset, errorA: null, errorB: null, errorClose: ZERO },
    { sendAUs: sends.a, sendBUs: sends.b, receiveAUs: receiveA, receiveBUs: receiveB, closeUs: close, delayAUs: delayA, delayBUs: delayB, delayDifferenceUs: target, completionWaitAUs: receiveA.sub(close), completionWaitBUs: receiveB.sub(close) });
}

function computeRace(input) {
  if (!input || typeof input.scenarioId !== 'string' || !input.scenarioId) throw new Error('scenarioId is required');
  const source = input.source === 'live-udp' ? 'live-udp' : 'frozen-deterministic';
  const capture = input.capture && typeof input.capture === 'object' ? input.capture : { kind: source };
  const { assumptions, observations } = exactInput(input);
  const sendHull = elapsedHull(observations.sendAUs - observations.sendBUs, assumptions.epsilonSenderPpm, assumptions.etaSenderUs);
  let interval;
  let evidenceKind;
  let auxiliary = null;
  if (observations.recvAUs !== null && observations.recvBUs !== null) {
    const receiveHull = elapsedHull(observations.recvAUs - observations.recvBUs, assumptions.epsilonReceiverPpm, assumptions.etaReceiverUs);
    interval = subtractIntervals(receiveHull, sendHull);
    evidenceKind = 'paired-arrivals';
    auxiliary = receiveHull;
  } else if (observations.recvAUs !== null) {
    const gapHull = elapsedHull(observations.recvAUs - observations.closeUs, assumptions.epsilonReceiverPpm, assumptions.etaReceiverUs);
    if (gapHull.lo.cmp(ZERO) > 0) throw new Error('A arrival cannot be before close under declared bounds');
    interval = { lo: null, hi: minRat(gapHull.hi, ZERO).sub(sendHull.lo) };
    evidenceKind = 'a-only-censored';
    auxiliary = gapHull;
  } else if (observations.recvBUs !== null) {
    const gapHull = elapsedHull(observations.closeUs - observations.recvBUs, assumptions.epsilonReceiverPpm, assumptions.etaReceiverUs);
    if (gapHull.hi.cmp(ZERO) < 0) throw new Error('B arrival cannot be before close under declared bounds');
    interval = { lo: maxRat(gapHull.lo, ZERO).sub(sendHull.hi), hi: null };
    evidenceKind = 'b-only-censored';
    auxiliary = gapHull;
  } else {
    interval = { lo: null, hi: null };
    evidenceKind = 'no-arrival';
  }
  const margin = new Rat(assumptions.marginUs);
  const outcome = classify(bounded(interval), margin);
  const feasible = feasibleOutcomes(bounded(interval), margin);
  const witnesses = outcome === 'ambiguous' ? feasible.map((name) => {
    const target = chooseTarget(interval, name, margin);
    if (evidenceKind === 'paired-arrivals') return pairedWitness(name, target, assumptions, observations, sendHull, auxiliary);
    if (evidenceKind === 'a-only-censored') return onlyAWitness(name, target, assumptions, observations, sendHull, auxiliary);
    if (evidenceKind === 'b-only-censored') return onlyBWitness(name, target, assumptions, observations, sendHull, auxiliary);
    return noArrivalWitness(name, target, assumptions, observations, sendHull);
  }) : [];
  const semantic = {
    schema: 'racecert-v2',
    scenarioId: input.scenarioId,
    source,
    capture,
    evidenceKind,
    assumptions: serializeIntegers(assumptions),
    observations: serializeIntegers(observations),
    interval: finiteIntervalJSON(interval),
    outcome,
    feasible,
    witnesses,
  };
  return { ...semantic, digest: digestSemantic(semantic) };
}

function aggregateCertificates(certificates, batchId = 'batch') {
  if (!Array.isArray(certificates) || certificates.length === 0) throw new Error('batch requires at least one certificate');
  const counts = { 'force-a': 0n, neutral: 0n, 'force-b': 0n, ambiguous: 0n };
  for (const certificate of certificates) {
    if (!certificate || certificate.schema !== 'racecert-v2' || !(certificate.outcome in counts)) throw new Error('invalid race certificate in batch');
    counts[certificate.outcome] += 1n;
  }
  const denominator = BigInt(certificates.length);
  let decision = 'no-forced-path-majority';
  if (2n * counts['force-a'] > denominator) decision = 'force-a-majority';
  if (2n * counts['force-b'] > denominator) decision = 'force-b-majority';
  const semantic = {
    schema: 'racecert-batch-v1',
    batchId,
    denominator: denominator.toString(),
    certificateDigests: certificates.map((item) => item.digest),
    counts: Object.fromEntries(Object.entries(counts).map(([key, value]) => [key, value.toString()])),
    decision,
    certificates,
  };
  return { ...semantic, digest: digestSemantic(semantic) };
}

module.exports = { Rat, canonical, computeRace, aggregateCertificates, digestSemantic };
