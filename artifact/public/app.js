'use strict';

let catalog = { frozen: [], live: [] };
let selection = null;
let currentCertificate = null;
let currentChecks = null;
let batch = [];
let busy = false;

const $ = (id) => document.getElementById(id);
const outcomeLabels = { 'force-a': 'Force A', 'force-b': 'Force B', neutral: 'Neutral', ambiguous: 'Ambiguous' };

function canonical(value) {
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  if (value && typeof value === 'object') return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonical(value[key])}`).join(',')}}`;
  if (typeof value === 'number' || typeof value === 'bigint' || value === undefined) throw new Error('non-schema numeric value');
  return JSON.stringify(value);
}

async function digestSemantic(document) {
  const semantic = structuredClone(document);
  delete semantic.digest;
  const bytes = new TextEncoder().encode(canonical(semantic));
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, '0')).join('');
}

async function request(url, options) {
  const response = await fetch(url, options);
  const result = await response.json();
  if (!response.ok || result.error) throw new Error(result.error || `HTTP ${response.status}`);
  return result;
}

function optionGroup(label, mode, items) {
  const group = document.createElement('optgroup');
  group.label = label;
  items.forEach((item, index) => {
    const option = document.createElement('option');
    option.value = `${mode}:${index}`;
    option.textContent = item.label;
    group.append(option);
  });
  return group;
}

async function load() {
  const response = await request('/api/catalog');
  catalog = response;
  $('scenario').replaceChildren(optionGroup('FROZEN | byte-stable fixtures', 'frozen', catalog.frozen), optionGroup('LIVE | non-deterministic localhost UDP', 'live', catalog.live));
  $('runtimeStatus').textContent = response.python.ok ? `${response.python.runtime} ready` : 'Python verifier unavailable';
  $('runtimeStatus').classList.toggle('warning', !response.python.ok);
  selectScenario('frozen:0');
  await run();
}

function selectedItem(value = $('scenario').value) {
  const [mode, rawIndex] = value.split(':');
  const index = Number(rawIndex);
  return { mode, item: mode === 'frozen' ? catalog.frozen[index] : catalog.live[index] };
}

function selectScenario(value) {
  selection = selectedItem(value);
  const item = selection.item;
  if (selection.mode === 'frozen') {
    $('epsilonSenderPpm').value = item.epsilonSenderPpm;
    $('epsilonReceiverPpm').value = item.epsilonReceiverPpm;
    $('eta').value = item.etaSenderUs;
    $('marginUs').value = item.marginUs;
    $('scenarioDescription').textContent = 'Frozen fixture: deterministic input and byte-stable certificate.';
    $('runNote').textContent = 'Reset reproduces the same digest.';
  } else {
    $('epsilonSenderPpm').value = '200';
    $('epsilonReceiverPpm').value = '200';
    $('eta').value = '2';
    $('marginUs').value = '500';
    $('scenarioDescription').textContent = item.description;
    $('runNote').textContent = 'Live timings and digest legitimately vary between runs.';
  }
  invalidateCertificate('Scenario selected. Run and certify to check these inputs.');
}

function canUseCertificate() {
  return !!(currentCertificate && currentChecks?.javascript?.ok && currentChecks?.python?.ok);
}

function setRunStatus(message, kind = 'pending') {
  $('runStatus').textContent = message;
  $('runStatus').className = `run-status full ${kind}`;
}

function invalidateCertificate(message, kind = 'pending') {
  currentCertificate = null;
  currentChecks = null;
  $('outcome').textContent = kind === 'error' ? 'Run failed' : 'Run required';
  $('outcome').className = 'pending';
  $('sourceBadge').textContent = 'No current certificate';
  $('sourceBadge').className = 'source-badge';
  $('evidence').textContent = 'The current inputs have not been certified.';
  $('censoringConvention').hidden = true;
  $('intervalText').textContent = 'I = pending';
  $('intervalMarker').className = '';
  $('intervalMarker').style.width = '0';
  $('digest').textContent = '-';
  $('captureMode').textContent = '-';
  $('timeline').replaceChildren(document.createTextNode('Run the current inputs to inspect events.'));
  $('witnessCount').textContent = '0';
  $('witnesses').replaceChildren(document.createTextNode('No current certificate.'));
  $('certificate').textContent = 'No current certificate.';
  renderChecker('jsChecker', 'JavaScript BigInt', null);
  renderChecker('pyChecker', 'Python Fraction', null);
  $('tamperResult').className = 'subtle';
  $('tamperResult').textContent = 'Run and certify before testing a semantic edit.';
  setRunStatus(message, kind);
  updateBatchControls();
}

function assumptions() {
  const result = {
    epsilonSenderPpm: $('epsilonSenderPpm').value.trim(),
    epsilonReceiverPpm: $('epsilonReceiverPpm').value.trim(),
    etaSenderUs: $('eta').value.trim(), etaReceiverUs: $('eta').value.trim(), marginUs: $('marginUs').value.trim(),
  };
  for (const [key, value] of Object.entries(result)) if (!/^\d+$/.test(value)) throw new Error(`${key} must be a nonnegative integer`);
  return result;
}

function resetInputs() {
  selectScenario($('scenario').value);
  run();
}

function setBusy(value) {
  busy = value;
  for (const id of ['run','reset','scenario','epsilonSenderPpm','epsilonReceiverPpm','eta','marginUs','loadCampaign']) $(id).disabled = busy;
  updateBatchControls();
  $('run').textContent = busy ? 'Working...' : 'Run and certify';
}

async function run() {
  if (busy) return;
  try {
    setBusy(true);
    invalidateCertificate(selection?.mode === 'live' ? 'Capturing loopback UDP and checking the certificate...' : 'Checking the current observations and bounds...');
    const custom = assumptions();
    let response;
    if (selection.mode === 'frozen') response = await request('/api/run-frozen', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ ...selection.item, ...custom }) });
    else response = await request('/api/run-live', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ scenarioId: selection.item.scenarioId, ...custom }) });
    currentCertificate = response.certificate;
    currentChecks = response.checks;
    renderCertificate();
  } catch (error) {
    invalidateCertificate(error.message, 'error');
  } finally {
    setBusy(false);
  }
}

function fractionText(value) {
  if (value === null) return null;
  if (value.d === '1') return value.n;
  return `${value.n}/${value.d}`;
}

function renderChecker(id, title, result) {
  const element = $(id);
  element.className = `checker ${result ? (result.ok ? 'pass' : 'fail') : 'pending'}`;
  element.replaceChildren();
  const strong = document.createElement('strong'); strong.textContent = title;
  const line = document.createElement('span'); line.textContent = checkerMessage(result);
  element.append(strong, line);
}

function checkerMessage(result) {
  if (!result) return 'Waiting for current inputs';
  if (result.ok) return `PASS | ${result.kind}`;
  return `${result.runtime === 'unavailable' ? 'ERROR' : 'REJECT'} | ${result.reason || 'no reason provided'}`;
}

function batchMessage(message, failed = false) {
  $('batchResult').className = `batch-result${failed ? ' verification-failed' : ''}`;
  $('batchResult').textContent = message;
}

function renderTimeline(certificate) {
  const list = $('timeline'); list.replaceChildren();
  const capture = certificate.capture || {};
  $('captureMode').textContent = capture.kind || certificate.source;
  if (Array.isArray(capture.events)) {
    capture.events.forEach((event) => {
      const item = document.createElement('li');
      const time = document.createElement('time'); time.textContent = `${event.monotonicUs} us`;
      const text = document.createElement('span');
      const detail = [event.round, event.path, event.status, event.reason, event.delayMs ? `${event.delayMs} ms` : null].filter(Boolean).join(' | ');
      text.textContent = `${event.type}${detail ? `  - ${detail}` : ''}`;
      item.append(time, text); list.append(item);
    });
  } else {
    const observations = certificate.observations;
    for (const [name, value] of Object.entries(observations)) {
      const item = document.createElement('li'); const time = document.createElement('time'); time.textContent = name;
      const text = document.createElement('span'); text.textContent = value === null ? 'censored / not observed' : `${value} us logical clock`;
      item.append(time, text); list.append(item);
    }
  }
}

function renderWitnesses(certificate) {
  const container = $('witnesses'); container.replaceChildren();
  $('witnessCount').textContent = String(certificate.witnesses.length);
  if (!certificate.witnesses.length) {
    const paragraph = document.createElement('p'); paragraph.className = 'subtle'; paragraph.textContent = 'All admissible assignments agree; no competing counterworld is needed.'; container.append(paragraph); return;
  }
  certificate.witnesses.forEach((witness) => {
    const details = document.createElement('details'); details.className = 'witness';
    const summary = document.createElement('summary'); summary.textContent = `${outcomeLabels[witness.outcome]} | Delta = ${fractionText(witness.assignment.real.delayDifferenceUs)} us`;
    const grid = document.createElement('dl');
    const rows = [
      ['sender rate', fractionText(witness.assignment.sender.rate), ' (dimensionless)'], ['receiver rate', fractionText(witness.assignment.receiver.rate), ' (dimensionless)'],
      ['delay A', fractionText(witness.assignment.real.delayAUs), ' us'], ['delay B', fractionText(witness.assignment.real.delayBUs), ' us'],
      ['wait A', fractionText(witness.assignment.real.completionWaitAUs), ' us'], ['wait B', fractionText(witness.assignment.real.completionWaitBUs), ' us'],
    ];
    rows.forEach(([key, value, unit]) => { const dt = document.createElement('dt'); dt.textContent = key; const dd = document.createElement('dd'); dd.textContent = `${value}${unit}`; grid.append(dt, dd); });
    const pre = document.createElement('pre'); pre.textContent = JSON.stringify(witness.assignment, null, 2);
    details.append(summary, grid, pre); container.append(details);
  });
}

function renderCertificate() {
  const certificate = currentCertificate;
  const verified = canUseCertificate();
  $('outcome').textContent = verified ? outcomeLabels[certificate.outcome] : 'Not verified';
  $('outcome').className = verified ? certificate.outcome : 'pending';
  $('sourceBadge').textContent = certificate.source === 'live-udp' ? 'LIVE | non-deterministic' : 'FROZEN | deterministic';
  $('sourceBadge').className = `source-badge ${certificate.source === 'live-udp' ? 'live' : 'frozen'}`;
  $('evidence').textContent = `${verified ? '' : `Candidate ${outcomeLabels[certificate.outcome]} | `}${certificate.evidenceKind.replaceAll('-', ' ')} | feasible: ${certificate.feasible.map(name => outcomeLabels[name]).join(' + ')}`;
  $('censoringConvention').hidden = certificate.evidenceKind === 'paired-arrivals';
  const lo = fractionText(certificate.interval.lo) ?? '-infinity';
  const hi = fractionText(certificate.interval.hi) ?? '+infinity';
  $('intervalText').textContent = `I = ${certificate.interval.lo === null ? '(' : '['}${lo}, ${hi}${certificate.interval.hi === null ? ')' : ']'} us (exact rational endpoints)`;
  $('digest').textContent = certificate.digest;
  $('intervalMarker').className = certificate.outcome;
  const firstRegion = ['force-a', 'neutral', 'force-b'].indexOf(certificate.feasible[0]);
  const lastRegion = ['force-a', 'neutral', 'force-b'].indexOf(certificate.feasible.at(-1));
  $('intervalMarker').style.left = `${7 + firstRegion * 33}%`;
  $('intervalMarker').style.width = `${20 + (lastRegion - firstRegion) * 33}%`;
  renderChecker('jsChecker', 'JavaScript BigInt', currentChecks.javascript);
  renderChecker('pyChecker', `Python Fraction | ${currentChecks.python.runtime}`, currentChecks.python);
  renderTimeline(certificate);
  renderWitnesses(certificate);
  $('certificate').textContent = JSON.stringify(certificate, null, 2);
  setRunStatus(canUseCertificate() ? 'Current inputs certified. JavaScript and Python both PASS.' : 'Verification failed. This certificate cannot enter the batch.', canUseCertificate() ? 'pass' : 'error');
  $('tamperResult').className = 'subtle';
  $('tamperResult').textContent = 'Ready: the attack will change semantics and recompute a valid new SHA-256.';
}

async function tamper() {
  if (busy || !canUseCertificate()) return;
  try {
    setBusy(true);
    const altered = structuredClone(currentCertificate);
    let mutation;
    if (altered.witnesses.length) {
      altered.witnesses[0].assignment.real.delayAUs = { n: '999999999', d: '1' };
      mutation = 'complete witness delay assignment';
    } else {
      altered.outcome = altered.outcome === 'force-b' ? 'force-a' : 'force-b';
      mutation = 'forced outcome';
    }
    altered.digest = await digestSemantic(altered);
    const result = await request('/api/verify', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(altered) });
    const rejected = !result.javascript.ok && !result.python.ok && result.python.runtime !== 'unavailable';
    $('tamperResult').className = rejected ? 'tamper-pass' : 'tamper-fail';
    $('tamperResult').textContent = rejected
      ? `PASS: rehashed ${mutation} rejected by JS (${result.javascript.reason}) and Python (${result.python.reason}). New digest ${altered.digest.slice(0, 16)}...`
      : `FAIL: JavaScript ${checkerMessage(result.javascript)}; Python ${checkerMessage(result.python)}.`;
  } catch (error) {
    $('tamperResult').className = 'tamper-fail'; $('tamperResult').textContent = error.message;
  } finally { setBusy(false); }
}

function addBatch() {
  if (busy || !canUseCertificate() || batch.some((item) => item.digest === currentCertificate.digest)) return;
  batch.push(structuredClone(currentCertificate));
  batchMessage('Batch changed. Verify batch to update its decision.');
  updateBatchControls();
}
function clearBatch() { batch = []; batchMessage('No batch yet.'); updateBatchControls(); }
function updateBatchControls() {
  $('batchSize').textContent = `${batch.length} race${batch.length === 1 ? '' : 's'}`;
  $('aggregate').disabled = busy || batch.length === 0; $('clearBatch').disabled = busy || batch.length === 0;
  $('addBatch').disabled = busy || !canUseCertificate() || batch.some((item) => item.digest === currentCertificate.digest);
  $('tamper').disabled = busy || !canUseCertificate();
}

async function aggregate() {
  if (busy || !batch.length) return;
  try {
    setBusy(true);
    batchMessage('Checking this batch with JavaScript and Python...');
    const result = await request('/api/aggregate', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ batchId: 'interactive-batch', certificates: batch }) });
    renderBatch(result);
  } catch (error) { batchMessage(`Batch verification failed: ${error.message}`, true); }
  finally { setBusy(false); }
}

function renderBatch(result) {
  const panel = $('batchResult'); panel.replaceChildren();
  const verified = result.checks.javascript.ok && result.checks.python.ok;
  panel.className = `batch-result${verified ? '' : ' verification-failed'}`;
  if (!verified) {
    const state = document.createElement('strong'); state.textContent = 'Batch not verified';
    const explanation = document.createElement('span'); explanation.textContent = 'No verified majority decision is available.';
    const js = document.createElement('span'); js.textContent = `JavaScript: ${checkerMessage(result.checks.javascript)}`;
    const py = document.createElement('span'); py.textContent = `Python: ${checkerMessage(result.checks.python)}`;
    panel.append(state, explanation, js, py);
    return;
  }
  const decision = document.createElement('strong'); decision.textContent = result.batch.decision.replaceAll('-', ' ');
  const counts = document.createElement('span'); counts.textContent = `N=${result.batch.denominator} | A ${result.batch.counts['force-a']} | neutral ${result.batch.counts.neutral} | B ${result.batch.counts['force-b']} | ambiguous ${result.batch.counts.ambiguous}`;
  const checks = document.createElement('span'); checks.textContent = `JS ${result.checks.javascript.ok ? 'PASS' : 'REJECT'} | Python ${result.checks.python.ok ? 'PASS' : 'REJECT'}`;
  panel.append(decision, counts, checks);
}

async function loadCampaign() {
  if (busy) return;
  try {
    setBusy(true);
    batchMessage('Replaying the retained 512 certificates with both checkers...');
    const result = await request('/api/campaign');
    if (!result.checks.javascript.ok || !result.checks.python.ok) { renderBatch(result); return; }
    batch = structuredClone(result.batch.certificates);
    renderBatch(result);
  } catch (error) { batchMessage(`Campaign replay failed: ${error.message}`, true); }
  finally { setBusy(false); }
}

$('scenario').addEventListener('change', (event) => selectScenario(event.target.value));
$('run').addEventListener('click', run);
$('reset').addEventListener('click', resetInputs);
$('tamper').addEventListener('click', tamper);
$('addBatch').addEventListener('click', addBatch);
$('aggregate').addEventListener('click', aggregate);
$('clearBatch').addEventListener('click', clearBatch);
$('loadCampaign').addEventListener('click', loadCampaign);
for (const id of ['epsilonSenderPpm','epsilonReceiverPpm','eta','marginUs']) $(id).addEventListener('input', () => invalidateCertificate('Inputs changed. Run and certify to update the certificate.'));
load().catch((error) => { invalidateCertificate(`Startup failed: ${error.message}`, 'error'); });
