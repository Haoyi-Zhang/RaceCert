'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { canonical, computeRace, aggregateCertificates, digestSemantic } = require('../producer');
const { verifyDocument } = require('../verifier-js');
const { runPythonVerifier } = require('../python-runner');
const { runLiveCapture } = require('../udp-transport');
const { runCampaign } = require('../campaign');
const { testUdpInitializationCleanup, testUdpRuntimeCleanup } = require('./udp-init-failures');

function rehash(document) {
  const semantic = structuredClone(document);
  delete semantic.digest;
  document.digest = digestSemantic(semantic);
  return document;
}

function rejectBoth(document, label) {
  const js = verifyDocument(document);
  const python = runPythonVerifier(document);
  assert.equal(js.ok, false, `${label}: JavaScript unexpectedly accepted`);
  assert.notEqual(python.runtime, 'unavailable', `${label}: Python could not execute: ${python.reason}`);
  assert.equal(python.ok, false, `${label}: Python unexpectedly accepted`);
  return { js: js.reason, python: python.reason };
}

async function main() {
  const root = path.resolve(__dirname, '..');
  const frozen = JSON.parse(fs.readFileSync(path.join(root, 'scenarios.json'), 'utf8'));
  const profiles = JSON.parse(fs.readFileSync(path.join(root, 'live-profiles.json'), 'utf8'));
  assert.equal(frozen.length, 6);
  assert.equal(profiles.length, 5);
  assert.throws(() => computeRace({ ...frozen[0], sendAUs: 0 }), /decimal integer string/, 'producer accepted a JavaScript Number');
  assert.equal(fs.readFileSync(path.join(root, 'verifier-js.js'), 'utf8').includes("require('./producer')"), false, 'JS verifier imports producer');

  const frozenCertificates = frozen.map((scenario) => {
    const first = computeRace(scenario);
    const second = computeRace(scenario);
    assert.equal(canonical(first), canonical(second), `${scenario.scenarioId}: frozen output is not byte-stable`);
    const check = verifyDocument(first);
    assert.equal(check.ok, true, `${scenario.scenarioId}: ${check.reason}`);
    if (first.outcome === 'ambiguous') assert.deepEqual(first.witnesses.map((item) => item.outcome), first.feasible, `${scenario.scenarioId}: missing complete counterworld`);
    return first;
  });
  const frozenBatch = aggregateCertificates(frozenCertificates, 'frozen-six');
  assert.equal(verifyDocument(frozenBatch).ok, true);
  const frozenPython = runPythonVerifier(frozenBatch);
  assert.equal(frozenPython.ok, true, frozenPython.reason);

  const boundary = frozenCertificates.find(c => c.scenarioId === 'censored-boundary');
  assert.equal(boundary.outcome, 'ambiguous');
  assert.equal(boundary.interval.lo, null);
  assert.deepEqual(boundary.interval.hi, { n: '-1000', d: '1' });
  assert.equal(boundary.assumptions.marginUs, '1000');
  assert.deepEqual(boundary.feasible, ['force-a', 'neutral']);
  const neutralBoundary = boundary.witnesses.find(w => w.outcome === 'neutral');
  assert.deepEqual(neutralBoundary.assignment.real.delayDifferenceUs, { n: '-1000', d: '1' });

  let wideningChecks = 0;
  for (const scenario of frozen) {
    const narrow = computeRace(scenario);
    for (const error of ['100', '1000', '10000']) {
      const wider = computeRace({ ...scenario, etaSenderUs: error, etaReceiverUs: error, epsilonSenderPpm: '20000', epsilonReceiverPpm: '20000' });
      assert.ok(narrow.feasible.every(outcome => wider.feasible.includes(outcome)), 'widened uncertainty lost a feasible policy region');
      const js = verifyDocument(wider), py = runPythonVerifier(wider);
      assert.equal(js.ok, true, js.reason); assert.equal(py.ok, true, py.reason);
      wideningChecks++;
    }
  }

  const tamperedOutcome = structuredClone(frozenCertificates[0]);
  tamperedOutcome.outcome = 'force-b';
  const outcomeRejection = rejectBoth(rehash(tamperedOutcome), 'rehashed outcome tamper');

  const ambiguous = frozenCertificates.find((certificate) => certificate.outcome === 'ambiguous' && certificate.witnesses.length > 0);
  assert.ok(ambiguous, 'missing ambiguous fixture');
  const tamperedWitness = structuredClone(ambiguous);
  tamperedWitness.witnesses[0].assignment.real.delayAUs = { n: '999999999', d: '1' };
  const witnessRejection = rejectBoth(rehash(tamperedWitness), 'rehashed witness tamper');
  let mutationChecks = 2;
  for (const [part, fields] of [
    ['sender', ['rate', 'offsetUs', 'readErrorAUs', 'readErrorBUs']],
    ['receiver', ['rate', 'offsetUs', 'readErrorAUs', 'readErrorCloseUs']],
    ['real', ['sendAUs', 'sendBUs', 'receiveAUs', 'receiveBUs', 'closeUs', 'delayAUs', 'delayBUs', 'delayDifferenceUs', 'completionWaitAUs', 'completionWaitBUs']],
  ]) for (const field of fields) {
    const changed = structuredClone(boundary);
    changed.witnesses[0].assignment[part][field] = { n: '999999999', d: '1' };
    rejectBoth(rehash(changed), `${part}.${field}`); mutationChecks++;
  }
  for (const mutate of [
    c => { c.interval.hi = { n: '-999', d: '1' }; },
    c => { c.witnesses.pop(); },
    c => { c.feasible = ['force-a']; },
    c => { c.interval.hiClosed = 'false'; },
  ]) { const changed = structuredClone(boundary); mutate(changed); rejectBoth(rehash(changed), 'derived field mutation'); mutationChecks++; }

  const forceA = frozenCertificates.find((item) => item.outcome === 'force-a');
  const forceB = frozenCertificates.find((item) => item.outcome === 'force-b');
  const neutral = frozenCertificates.find((item) => item.outcome === 'neutral');
  const unresolved = frozenCertificates.find((item) => item.outcome === 'ambiguous');
  const aMajority = aggregateCertificates([forceA, forceA, neutral], 'a-majority');
  const bMajority = aggregateCertificates([forceB, unresolved, forceB], 'b-majority');
  const noMajority = aggregateCertificates([forceA, forceB, unresolved, neutral], 'fixed-denominator-no-majority');
  assert.equal(aMajority.decision, 'force-a-majority');
  assert.equal(bMajority.decision, 'force-b-majority');
  assert.equal(noMajority.denominator, '4');
  assert.equal(noMajority.decision, 'no-forced-path-majority');
  for (const batch of [aMajority, bMajority, noMajority]) {
    assert.equal(verifyDocument(batch).ok, true);
    const python = runPythonVerifier(batch);
    assert.equal(python.ok, true, python.reason);
  }
  for (const mutate of [
    c => { c.denominator = '3'; },
    c => { c.counts.ambiguous = '0'; },
    c => { c.decision = 'force-a-majority'; },
    c => { c.certificateDigests[0] = '0'.repeat(64); },
  ]) { const changed = structuredClone(noMajority); mutate(changed); rejectBoth(rehash(changed), 'batch mutation'); mutationChecks++; }

  const liveResults = [];
  for (const profile of profiles) {
    const captureInput = await runLiveCapture(profile);
    const certificate = computeRace(captureInput);
    const js = verifyDocument(certificate);
    const python = runPythonVerifier(certificate);
    assert.equal(js.ok, true, `${profile.scenarioId}: ${js.reason}`);
    assert.equal(python.ok, true, `${profile.scenarioId}: ${python.reason}`);
    liveResults.push({ profile, certificate });
  }
  const byId = Object.fromEntries(liveResults.map((item) => [item.profile.scenarioId, item.certificate]));
  assert.deepEqual(byId['live-delay'].capture.acceptedOrder, ['A', 'B']);
  assert.deepEqual(byId['live-reorder'].capture.acceptedOrder, ['B', 'A']);
  assert.ok(byId['live-drop'].capture.events.some((event) => event.type === 'relay-drop' && event.path === 'B'));
  assert.ok(byId['live-deadline'].capture.events.some((event) => event.status === 'late-after-close' && event.path === 'B'));
  assert.ok(byId['live-disconnect-recovery'].capture.events.some((event) => event.type === 'link-recovery'));
  assert.ok(byId['live-disconnect-recovery'].capture.events.filter((event) => event.type === 'relay-drop').length >= 2);
  const initializationFaultChecks = await testUdpInitializationCleanup(profiles[0]);
  const runtimeFaultChecks = await testUdpRuntimeCleanup(profiles[0]);

  const testRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'racecert-selftest-'));
  const campaignDirectory = path.join(testRoot, 'campaign');
  let campaign;
  try {
    campaign = runCampaign({ runs: '64', output: campaignDirectory });
    assert.equal(campaign.summary.runs, '64');
    assert.equal(campaign.summary.jsVerifier.ok, true);
    assert.equal(campaign.summary.pythonVerifier.ok, true);
    assert.equal(campaign.manifest.files.length, 3);
  } finally {
    const resolved = path.resolve(testRoot);
    const parent = path.resolve(os.tmpdir());
    assert.equal(path.dirname(resolved), parent, 'unexpected temporary test parent');
    assert.ok(path.basename(resolved).startsWith('racecert-selftest-'), 'unexpected temporary test name');
    fs.rmSync(resolved, { recursive: true, force: true });
  }

  const summary = {
    ok: true,
    exactProducer: 'BigInt rational only',
    frozenScenarios: String(frozenCertificates.length),
    ambiguousWitnessesChecked: String(frozenCertificates.reduce((count, item) => count + item.witnesses.length, 0)),
    independentVerifiers: ['standalone JavaScript BigInt', 'Python fractions.Fraction'],
    rehashedTamperRejections: { outcome: outcomeRejection, witness: witnessRejection },
    aggregationCases: { forceA: aMajority.decision, forceB: bMajority.decision, fixedDenominator: noMajority.decision },
    liveUdpProfiles: Object.fromEntries(liveResults.map(({ profile, certificate }) => [profile.scenarioId, { evidence: certificate.evidenceKind, outcome: certificate.outcome, acceptedOrder: certificate.capture.acceptedOrder }])),
    campaignFixtures: campaign.summary.runs,
    censoredBoundary: { interval: boundary.interval, marginUs: '1000', outcome: boundary.outcome, feasible: boundary.feasible },
    wideningChecks: String(wideningChecks),
    rehashedMutationsRejectedByBoth: String(mutationChecks),
    mockedUdpInitializationFaults: String(initializationFaultChecks),
    mockedUdpRuntimeFaults: String(runtimeFaultChecks),
  };
  process.stdout.write(`${JSON.stringify(summary)}\n`);
}

main().catch((error) => { process.stderr.write(`${error.stack}\n`); process.exitCode = 1; });
