'use strict';

// Presentation-only input. Never inserted into the published fixtures or campaign.
const ETA_PRESETS = ['0', '249', '250', '750', '751', '1000'];
const LABELS = { 'force-a': 'Force A', neutral: 'Neutral', 'force-b': 'Force B', ambiguous: 'Ambiguous' };
const REGION_LABELS = { 'force-a': 'A region', neutral: 'Neutral region', 'force-b': 'B region' };
function teachingInput(eta = '0') {
  if (!ETA_PRESETS.includes(eta)) throw new Error('Choose a supported per-read error preset.');
  return {
    scenarioId: 'guided-teaching-arrival-order', source: 'frozen-deterministic',
    capture: { kind: 'fixed-illustrative-teaching-input', provenance: 'Added for presentation; outside published 6 fixtures and retained 512.' },
    sendAUs: '0', sendBUs: '4000', recvAUs: '10000', recvBUs: '12000', closeUs: '15000',
    epsilonSenderPpm: '0', epsilonReceiverPpm: '0', etaSenderUs: eta, etaReceiverUs: eta, marginUs: '1000',
  };
}
function canonical(value) {
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  if (value && typeof value === 'object') return `{${Object.keys(value).sort().map(key => `${JSON.stringify(key)}:${canonical(value[key])}`).join(',')}}`;
  if (typeof value === 'number' || typeof value === 'bigint' || value === undefined) throw new Error('Non-schema numeric value in canonical payload.');
  return JSON.stringify(value);
}
async function digestSemantic(doc) {
  if (!globalThis.crypto?.subtle) throw new Error('SHA-256 unavailable. Open this demo on http://127.0.0.1 or localhost. No tamper result has been accepted.');
  const semantic = structuredClone(doc); delete semantic.digest;
  const bytes = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(canonical(semantic)));
  return Array.from(new Uint8Array(bytes), b => b.toString(16).padStart(2, '0')).join('');
}
function addOneUs(q) {
  const n = BigInt(q.n), d = BigInt(q.d);
  if (d <= 0n) throw new Error('Invalid rational denominator.');
  let a = n + d, b = d, x = a < 0n ? -a : a, y = b;
  while (y) [x, y] = [y, x % y];
  const divisor = x || 1n;
  return { n: (a / divisor).toString(), d: (b / divisor).toString() };
}
// The server marks a failed Python process as runtime=unavailable. A missing or
// malformed verifier result is ERROR as well, never a semantic rejection.
function checkerState(result) {
  if (!result || typeof result.ok !== 'boolean' || result.runtime === 'unavailable' || result.error || result.status === 'error') return 'ERROR';
  if (result.ok === true) return 'PASS';
  return typeof result.reason === 'string' && result.reason.length ? 'REJECT' : 'ERROR';
}
function twoPass(checks, doc) {
  return !!doc && ['javascript', 'python'].every(k => checkerState(checks?.[k]) === 'PASS' && checks[k].digest === doc.digest);
}
function twoReject(checks) {
  return ['javascript', 'python'].every(k => checkerState(checks?.[k]) === 'REJECT');
}
function fraction(q) { return q === null ? 'not used / unobserved' : q.d === '1' ? q.n : `${q.n}/${q.d}`; }
function esc(value) { return String(value).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]); }
function percent(n, d) { return d === 0n ? 'undefined' : `${((n * 1000n + d / 2n) / d / 10n)}.${((n * 1000n + d / 2n) / d) % 10n}%`; }
function comparison(batch) {
  const n = BigInt(batch.denominator), b = BigInt(batch.counts['force-b']), ambiguous = BigInt(batch.counts.ambiguous);
  return { n, b, ambiguous, conditionalN: n - ambiguous, allPercent: percent(b, n), conditionalPercent: percent(b, n - ambiguous) };
}

function startGuided() {
  const $ = id => document.getElementById(id);
  const state = { step: 0, eta: '1000', busy: false, version: 0, generation: 0, operation: null, doc: null, checks: null, tampered: null, tamperChecks: null, witness: 0, live: null, catalog: null };
  const stage = $('stage');
  const descriptions = [
    ['Inspect the controlled log', 'A arrives first on the receiver clock. Does that identify the faster path? Inspect each endpoint separately before making a claim.'],
    ['Certify the delay difference', 'Keep the log fixed. With exact rates and zero read error, ask the producer for Δ = delay A − delay B, then check its certificate twice.'],
    ['The same readings with wider error bounds', 'Change only the per-read error bound η on both endpoints. Boundary values count as neutral. Select a preset, then run it explicitly.'],
    ['Explore three admissible worlds', 'Re-run the fixed log with ηSender = ηReceiver = 1000 µs. Select a verified witness to inspect a complete admissible clock and event assignment.'],
    ['A one-microsecond inconsistency', 'Certify the η = 1000 µs teaching case. Add exactly 1 µs to the first witness’s delay A, change nothing else, recompute the digest, and check the edited candidate.'],
    ['Replay the retained 512', 'Read and independently verify the existing retained batch. Keep every race in the denominator, then compare a separately labeled conditional question.'],
  ];
  function announce(message, error = false) { $('status').textContent = message; $('status').className = `status${error ? ' error' : ''}`; }
  function resetResult() {
    state.version++; state.doc = null; state.checks = null; state.tampered = null; state.tamperChecks = null; state.witness = 0;
  }
  function isCurrentOperation(operation) {
    return state.operation === operation && state.generation === operation.generation;
  }
  function requireCurrentOperation(operation) {
    if (operation && !isCurrentOperation(operation)) throw new Error('Run is no longer current. Its result is discarded.');
  }
  function beginOperation(kind, fallback) {
    const operation = { kind, generation: ++state.generation, controller: null, focus: rememberFocus(fallback) };
    state.operation = operation; state.busy = true; updateControls();
    return operation;
  }
  function finishOperation(operation) {
    if (!isCurrentOperation(operation)) return;
    state.operation = null; state.busy = false; updateControls(); restoreFocus(operation.focus);
  }
  function cancelRun() {
    const operation = state.operation;
    if (!state.busy || !operation || !isCurrentOperation(operation)) return;
    // Invalidate before aborting: even already-resolved fetch/body/digest promises
    // must not publish, launch the next phase, or unlock a subsequent run.
    state.operation = null; state.generation++;
    operation.controller?.abort(); operation.focus.release();
    state.busy = false; resetResult(); state.live = null;
    $('live-result').replaceChildren(); renderStep();
    const target = operation.kind === 'live' ? $('live-result') : $('stage-result');
    target.innerHTML = '<p class="notice cancelled result">Cancelled · browser waiting stopped; current result discarded. Server calculation or capture may continue. Run an action explicitly to retry.</p>';
    announce('Cancelled. Current result discarded; no accepted result from this run. Server calculation or capture may continue. Retry explicitly.');
    focusAndReveal(operation.kind === 'live' ? ($('live-panel').open ? $('live-run') : $('live-panel').querySelector('summary')) : $('workflow-action'));
  }
  function focusAndReveal(target, reveal = true) {
    if (!target || target.disabled) return;
    target.focus({ preventScroll: true });
    if (!reveal) return;
    const controls = $('workflow-controls');
    const top = controls.contains(target) ? 8 : Math.max(0, controls.getBoundingClientRect().bottom) + 12;
    const rect = target.getBoundingClientRect();
    if (rect.top < top || rect.bottom > window.innerHeight) window.scrollBy({ top: rect.top - top, behavior: 'auto' });
  }
  function rememberFocus(fallback) {
    const active = document.activeElement;
    const node = active === document.body || active === document.documentElement ? null : active;
    const saved = { node, id: node?.id, fallback, interacted: false };
    const mark = event => {
      if (!event.defaultPrevented && (event.type !== 'keydown' || ['ArrowUp', 'ArrowDown', 'PageUp', 'PageDown', 'Home', 'End', ' '].includes(event.key))) saved.interacted = true;
    };
    const events = ['wheel', 'touchmove', 'pointerdown', 'keydown'];
    events.forEach(type => window.addEventListener(type, mark, { passive: true }));
    saved.release = () => events.forEach(type => window.removeEventListener(type, mark));
    return saved;
  }
  function restoreFocus(saved) {
    saved.release();
    const active = document.activeElement;
    // Do not steal focus or scroll from someone inspecting evidence during a run.
    if (active && active !== document.body && active !== document.documentElement && active.isConnected && active !== saved.node) return;
    let target = saved.node?.isConnected && !saved.node.disabled ? saved.node : (saved.id && $(saved.id)) || $(saved.fallback);
    if (!target || target.disabled || !target.getClientRects().length) {
      target = saved.fallback === 'live-run' && !$('live-panel').open ? $('live-panel').querySelector('summary') : $('workflow-action');
    }
    // Layout shrinkage is not user scrolling: still reveal a replacement control.
    focusAndReveal(target, !saved.interacted);
  }
  function updateControls() {
    document.querySelectorAll('button, select').forEach(el => {
      el.disabled = state.busy || ((el.id === 'live-run' || el.id === 'live-profile') && !state.catalog?.live?.length);
    });
    $('workflow-cancel').disabled = !state.busy || !state.operation;
    $('workflow-cancel-note').hidden = !state.busy || !state.operation;
    stage.setAttribute('aria-busy', String(state.busy));
    $('live-result').setAttribute('aria-busy', String(state.busy));
    $('workflow-controls').setAttribute('aria-busy', String(state.busy));
    $('workflow-previous').disabled = state.busy || state.step === 0;
    $('workflow-next').disabled = state.busy || state.step === descriptions.length - 1;
    const action = $('stage-action') || $('inspect-next');
    $('workflow-action').disabled = state.busy || !action;
    $('workflow-action').textContent = action?.textContent || 'No action available';
  }
  function header() {
    const [title, copy] = descriptions[state.step];
    return `<div class="stage-head"><div><p class="eyebrow">STEP ${state.step + 1} / 6 · ${state.step === 5 ? 'RETAINED EVIDENCE' : 'ILLUSTRATIVE TEACHING INPUT'}</p><h2 id="stage-title" tabindex="-1">${title}</h2><p class="stage-copy">${copy}</p></div></div>`;
  }
  function bounds(eta, live = false) {
    return `<div class="bounds" aria-label="Declared assumptions"><span>Rate error: ${live ? '200' : '0'} ppm / endpoint</span><span>ηSender = ηReceiver = ${esc(eta)} µs / read</span><span>Margin: ${live ? '500' : '1000'} µs</span></div>`;
  }
  function clockTables(obs = teachingInput()) {
    const value = key => obs[key] === null ? 'not observed (censored)' : `${esc(obs[key])} µs`;
    return `<div class="clock-grid"><section class="clock"><h3>Sender clock · its own origin</h3><table aria-label="Sender clock observations"><thead><tr><th scope="col">Event</th><th scope="col">Local reading</th></tr></thead><tbody><tr><td class="path-a">Send A</td><td>${value('sendAUs')}</td></tr><tr><td class="path-b">Send B</td><td>${value('sendBUs')}</td></tr></tbody></table></section><section class="clock"><h3>Receiver clock · its own origin</h3><table aria-label="Receiver clock observations"><thead><tr><th scope="col">Event</th><th scope="col">Local reading</th></tr></thead><tbody><tr><td class="path-a">Receive A</td><td>${value('recvAUs')}</td></tr><tr><td class="path-b">Receive B</td><td>${value('recvBUs')}</td></tr><tr><td>Close</td><td>${value('closeUs')}</td></tr></tbody></table></section></div><p class="clock-warning">These are two local clocks—not a shared wall-clock axis. Do not subtract a sender reading from a receiver reading to infer an individual path delay.</p>`;
  }
  function observationsDetail(doc) {
    return `<details class="evidence"><summary>Inspect unchanged observations + provenance</summary>${clockTables(doc.observations)}<p>Source: ${esc(doc.capture?.kind || doc.source)}. ${esc(doc.capture?.provenance || '')}</p></details>`;
  }
  function renderStep() {
    document.querySelector('.shell').dataset.activeStep = String(state.step);
    document.querySelectorAll('[data-step]').forEach(button => {
      if (Number(button.dataset.step) === state.step) button.setAttribute('aria-current', 'step');
      else button.removeAttribute('aria-current');
    });
    let body;
    if (state.step === 0) body = `${bounds('0')}${clockTables()}<div class="action-row"><button class="primary" id="inspect-next" type="button">Continue to certification →</button><span class="action-note">Inspection only. No verdict has been computed.</span></div>`;
    else if (state.step === 2) body = `<div class="preset-row"><label for="eta-preset">Per-read error on both endpoint clocks</label><select id="eta-preset">${ETA_PRESETS.map(eta => `<option value="${eta}"${state.eta === eta ? ' selected' : ''}>η = ${eta} µs${eta === '1000' ? ' · three-world teaching case' : ''}</option>`).join('')}</select></div>${bounds(state.eta)}<div class="action-row"><button class="primary" id="stage-action" type="button">Run preset + verify</button><span class="action-note">Same five observations. No automatic run.</span></div><div id="stage-result"></div>`;
    else {
      const action = { 1: 'Compute + verify', 3: 'Build + verify all three witnesses', 4: 'Certify baseline → edit +1 µs → verify', 5: 'Replay + verify retained batch' }[state.step];
      body = `${state.step === 5 ? '' : bounds(state.step === 1 ? '0' : '1000')}<div class="action-row"><button class="primary" id="stage-action" type="button">${action}</button><span class="action-note">${state.step === 5 ? 'Read-only replay; no new campaign is generated.' : state.step >= 3 ? 'Fresh η = 1000 µs run, independent of the step 3 preset.' : 'No verified claim until both checkers PASS.'}</span></div><div id="stage-result"></div>`;
    }
    stage.innerHTML = header() + body;
    const current = `Step ${state.step + 1} / ${descriptions.length} · ${descriptions[state.step][0]}`;
    $('workflow-current').textContent = current;
    $('help-current').textContent = `Current step: ${state.step + 1} / ${descriptions.length} · ${descriptions[state.step][0]}`;
    $('inspect-next')?.addEventListener('click', () => chooseStep(1));
    $('stage-action')?.addEventListener('click', runStage);
    $('eta-preset')?.addEventListener('change', event => {
      if (state.busy) return;
      const focus = rememberFocus('eta-preset');
      state.eta = event.target.value; resetResult(); renderStep();
      restoreFocus(focus);
      announce('η changed. Previous claims cleared; run this preset to obtain a current result.');
    });
    updateControls();
  }
  function chooseStep(step, restart = false) {
    if (state.busy || !Number.isInteger(step) || step < 0 || step >= descriptions.length || (!restart && step === state.step)) return;
    if (restart) {
      state.eta = '1000';
      $('live-panel').open = false;
      $('live-profile').selectedIndex = 0;
      describeLive();
    }
    state.step = step; resetResult(); state.live = null; $('live-result').replaceChildren(); renderStep();
    announce(restart ? 'Restarted at step 1 with η = 1000 µs selected. All claims cleared; optional LIVE reset and collapsed. Nothing has run.' : 'Step selected. Previous results cleared. Choose the action to run the local APIs.');
    focusAndReveal($('stage-title'));
  }
  function runCurrentAction() {
    if (state.busy) return;
    // Delegate once to the existing explicit action, retaining its QA selector.
    const action = $('stage-action') || $('inspect-next');
    if (action && !action.disabled) action.click();
  }
  async function request(url, payload, operation = null) {
    // Catalog metadata has its own request/timeout and never owns a run token.
    requireCurrentOperation(operation);
    const controller = new AbortController();
    if (operation) operation.controller = controller;
    const timer = setTimeout(() => controller.abort(), 90000);
    try {
      const response = await fetch(url, { method: payload === undefined ? 'GET' : 'POST', headers: payload === undefined ? undefined : { 'content-type': 'application/json' }, body: payload === undefined ? undefined : JSON.stringify(payload), signal: controller.signal, cache: 'no-store' });
      requireCurrentOperation(operation);
      const result = await response.json();
      requireCurrentOperation(operation);
      if (!response.ok || result.error) throw new Error(result.error || `HTTP ${response.status}`);
      return result;
    } catch (error) {
      requireCurrentOperation(operation);
      if (error.name === 'AbortError') throw new Error('Local API timed out. Runtime ERROR; no verification claim is available.');
      throw error;
    } finally {
      clearTimeout(timer); // This timer/controller belongs only to this request.
      if (operation && isCurrentOperation(operation) && operation.controller === controller) operation.controller = null;
    }
  }
  function checksHTML(checks, doc, label = 'Certificate checks') {
    return `<div class="checks" aria-label="${esc(label)}">${['javascript', 'python'].map(k => {
      const r = checks?.[k]; let status = checkerState(r);
      if (status === 'PASS' && doc && r.digest !== doc.digest) status = 'ERROR';
      const reason = status === 'ERROR' && r?.ok ? 'Verifier digest does not bind this document.' : r?.reason || (status === 'PASS' ? `Exact ${r.kind || 'document'} verification${r.witnessesVerified !== undefined ? ` · ${r.witnessesVerified} witnesses checked` : r.racesVerified !== undefined ? ` · ${r.racesVerified} races checked` : ''}` : 'Missing or invalid runtime response.');
      return `<div class="check ${status.toLowerCase()}"><strong>${k === 'javascript' ? 'JavaScript · BigInt' : 'Python · Fraction'} — ${status}</strong><span>${esc(reason)}</span></div>`;
    }).join('')}</div>`;
  }
  function intervalFigure(doc) {
    const qn = q => q === null ? null : Number(q.n) / Number(q.d);
    const low = qn(doc.interval.lo), high = qn(doc.interval.hi), margin = Number(doc.assumptions.marginUs);
    if (![low, high, margin].every(v => v !== null && Number.isFinite(v))) return '';
    const min = Math.min(low, -margin) - Math.max(margin, (high - low) * .08, 1);
    const max = Math.max(high, margin) + Math.max(margin, (high - low) * .08, 1);
    const x = value => 28 + (value - min) / (max - min) * 744;
    const left = x(-margin), right = x(margin), start = x(low), end = x(high);
    const colors = { 'force-a': '#2563b9', 'force-b': '#087c75', neutral: '#626b78', ambiguous: '#7546b1' };
    const title = `Exact delay-difference interval ${fraction(doc.interval.lo)} to ${fraction(doc.interval.hi)} microseconds; neutral includes minus and plus ${margin}.`;
    return `<figure class="interval"><svg viewBox="0 0 800 108" role="img" aria-label="${esc(title)}"><title>${esc(title)}</title><rect x="28" y="33" width="${left - 28}" height="16" fill="#2563b915"/><rect x="${left}" y="33" width="${right - left}" height="16" fill="#626b781a"/><rect x="${right}" y="33" width="${772 - right}" height="16" fill="#087c7515"/><text x="${(28 + left) / 2}" y="20" text-anchor="middle" font-size="12" fill="#2563b9">A</text><text x="${(left + right) / 2}" y="20" text-anchor="middle" font-size="12" fill="#626b78">neutral</text><text x="${(right + 772) / 2}" y="20" text-anchor="middle" font-size="12" fill="#087c75">B</text><path d="M28 56H772 M${left} 29V65 M${right} 29V65" stroke="#8a96a3" stroke-width="1"/><path d="M${start} 41H${end}" stroke="${colors[doc.outcome] || colors.neutral}" stroke-width="6"/><circle cx="${start}" cy="41" r="5" fill="${colors[doc.outcome] || colors.neutral}"/><circle cx="${end}" cy="41" r="5" fill="${colors[doc.outcome] || colors.neutral}"/><text x="${left}" y="81" text-anchor="middle" font-size="12" fill="#506277">−${margin}</text><text x="${right}" y="81" text-anchor="middle" font-size="12" fill="#506277">+${margin}</text><text x="772" y="100" text-anchor="end" font-size="11" fill="#506277">Δ (µs)</text></svg><figcaption>Delay-difference axis, not event time. Filled endpoints are included; neutral includes ±margin. The exact rational interval is printed above.</figcaption></figure>`;
  }
  function evidenceHTML(doc, download = 'stage') {
    return `<details class="evidence"><summary>Certificate JSON + canonical SHA-256</summary><p class="hash">${esc(doc.digest)}</p><p>SHA-256 binds the canonical document excluding its digest field. Semantic validity still requires both verifiers.</p><pre>${esc(JSON.stringify(doc, null, 2))}</pre><div class="action-row"><button class="secondary" data-download="${download}" type="button">Download JSON</button></div></details>`;
  }
  function attachDownloads(container) {
    container.querySelectorAll('[data-download]').forEach(button => button.addEventListener('click', () => {
      if (state.busy) return;
      const doc = button.dataset.download === 'live' ? state.live?.certificate : button.dataset.download === 'tampered' ? state.tampered : state.doc;
      if (!doc) return;
      const url = URL.createObjectURL(new Blob([JSON.stringify(doc, null, 2) + '\n'], { type: 'application/json' }));
      const anchor = document.createElement('a'); anchor.href = url; anchor.download = `racecert-${button.dataset.download}.json`; anchor.click();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    }));
  }
  function verifiedRaceHTML(doc, checks, download = 'stage') {
    if (!twoPass(checks, doc)) return `<div class="result"><p class="notice error">Not verified. No accepted interval, outcome, or witness claim is available.</p>${checksHTML(checks, doc)}${evidenceHTML(doc, download)}</div>`;
    const feasible = doc.feasible.map(k => REGION_LABELS[k] || k).join(' + ');
    const interval = `${doc.interval.lo === null ? '(−∞' : `[${fraction(doc.interval.lo)}`}, ${doc.interval.hi === null ? '+∞)' : `${fraction(doc.interval.hi)}]`}`;
    const offsetNote = doc.source === 'frozen-deterministic' && doc.assumptions.etaSenderUs === '0' && doc.assumptions.etaReceiverUs === '0' ? ' Only relative Δ is identified; endpoint offsets are not synchronized, and individual path delays are not uniquely determined.' : '';
    return `<div class="result"><div class="result-header"><p class="verdict ${esc(doc.outcome)}">${esc(LABELS[doc.outcome] || doc.outcome)}</p><p class="exact">Δ ∈ ${esc(interval)} µs</p></div><p class="result-copy">Two PASS · ${esc(doc.evidenceKind)} · feasible: ${esc(feasible)}.${offsetNote}</p>${checksHTML(checks, doc)}${intervalFigure(doc)}${observationsDetail(doc)}${evidenceHTML(doc, download)}</div>`;
  }
  function requireTeachingBinding(doc, input) {
    if (!doc || doc.scenarioId !== input.scenarioId || doc.source !== 'frozen-deterministic') throw new Error('Returned document does not bind the requested teaching input.');
    if (canonical(doc.capture) !== canonical(input.capture)) throw new Error('Returned teaching provenance differs from the requested source.');
    for (const key of ['sendAUs', 'sendBUs', 'recvAUs', 'recvBUs', 'closeUs']) if (doc.observations?.[key] !== input[key]) throw new Error(`Returned observation differs: ${key}.`);
    for (const key of ['epsilonSenderPpm', 'epsilonReceiverPpm', 'etaSenderUs', 'etaReceiverUs', 'marginUs']) if (doc.assumptions?.[key] !== input[key]) throw new Error(`Returned assumption differs: ${key}.`);
  }
  function threeWorlds(doc) {
    return doc?.witnesses?.length === 3 && ['force-a', 'neutral', 'force-b'].every(k => doc.witnesses.some(w => w.outcome === k));
  }
  async function runStage() {
    if (state.busy) return;
    resetResult(); const step = state.step;
    const operation = beginOperation(step === 5 ? 'retained' : 'teaching', 'stage-action');
    $('stage-result').innerHTML = '<p class="notice result">Working with the local APIs. No accepted result yet.</p>';
    announce(step === 5 ? 'Replaying the existing retained batch with both verifiers…' : 'Producing a fresh certificate and running both independent verifiers…');
    try {
      if (step === 5) {
        const response = await request('/api/campaign', undefined, operation);
        if (!isCurrentOperation(operation)) return;
        if(response.batch?.denominator!=='512' || response.batch.certificates?.length!==512 || ['force-a','neutral','force-b','ambiguous'].some((key,index)=>response.batch.counts?.[key]!==['176','12','191','133'][index])) throw new Error('Returned retained batch differs from the published 512-race evidence.');
        state.doc = response.batch; state.checks = response.checks; renderCampaign();
      } else {
        const input = teachingInput(step === 1 ? '0' : step === 2 ? state.eta : '1000');
        const response = await request('/api/run-frozen', input, operation);
        if (!isCurrentOperation(operation)) return;
        requireTeachingBinding(response.certificate, input);
        state.doc = response.certificate; state.checks = response.checks;
        if (!twoPass(state.checks, state.doc)) {
          $('stage-result').innerHTML = verifiedRaceHTML(state.doc, state.checks);
          announce('Verification incomplete. No accepted teaching verdict.', true);
        } else if (step >= 3 && !threeWorlds(state.doc)) {
          throw new Error('The fresh η = 1000 µs response does not contain the required three witnesses.');
        } else if (step === 3) {
          renderWorlds(); announce('Fresh η = 1000 µs certificate: both PASS; all three witnesses checked. Select any world.');
        } else if (step === 4) {
          await runTamper(operation);
          if (!isCurrentOperation(operation)) return;
        }
        else {
          $('stage-result').innerHTML = verifiedRaceHTML(state.doc, state.checks);
          const proof = document.createElement('details'); proof.className = 'evidence';
          const summary = document.createElement('summary'); summary.textContent = 'Why this exact interval?';
          const note = document.createElement('p'); note.className = 'formula';
          note.textContent = step === 1 ? 'Δ = (10000 − 12000) − (0 − 4000) = 2000 µs' : `Δ ∈ [2000 − 4×${state.eta}, 2000 + 4×${state.eta}] µs`;
          const explanation = document.createElement('p');
          explanation.textContent = step === 1 ? 'A arrives earlier, but B’s path delay is lower by 2 ms (> the 1 ms margin). Only the difference is identified; arbitrary endpoint offsets remain, so individual path delays are not uniquely determined.' : 'Each endpoint’s elapsed difference includes two read errors. Their interval difference widens by 4η on each side. Δ < −1000 means A; −1000 ≤ Δ ≤ 1000 means neutral; Δ > 1000 means B. All endpoint clock offsets remain unconstrained.';
          proof.append(summary, note, explanation);
          $('stage-result').querySelector('.interval').after(proof);
          announce('Current preset certified by two PASS results. Displayed interval and feasible outcomes are returned by the producer.');
        }
      }
      if (!isCurrentOperation(operation)) return;
      attachDownloads($('stage-result'));
    } catch (error) {
      if (!isCurrentOperation(operation)) return;
      resetResult();
      $('stage-result').innerHTML = `<p class="notice error result">Runtime / workflow ERROR: ${esc(error.message)} No accepted claim, and no successful tamper rejection.</p>`;
      announce('Run failed. Previous results cleared; retry the action when the runtime is ready.', true);
    } finally { finishOperation(operation); }
  }
  const assignmentNames = {
    rate: 'Clock rate (dimensionless)', offsetUs: 'Clock offset', readErrorAUs: 'A read error', readErrorBUs: 'B read error', readErrorCloseUs: 'Close read error',
    sendAUs: 'Real send A', sendBUs: 'Real send B', receiveAUs: 'Real receive A', receiveBUs: 'Real receive B', closeUs: 'Real close',
    delayAUs: 'Path delay A', delayBUs: 'Path delay B', delayDifferenceUs: 'Δ = delay A − delay B', completionWaitAUs: 'Completion wait A', completionWaitBUs: 'Completion wait B',
  };
  function assignmentHTML(witness) {
    return `<details class="evidence"><summary>Full clock / event / error assignment</summary><p>One admissible world—not a uniquely recovered clock or path delay. Local reading = rate × real event time + offset + read error. All values below are exact rationals; time units are µs. Schema witness “outcome” names identify feasible regions here, not a global Force A / Force B verdict.</p><div class="assignment">${['sender', 'receiver', 'real'].map(part => `<section class="${part}"><h3>${part === 'real' ? 'Real event / delay assignment in this witness' : `${part === 'sender' ? 'Sender' : 'Receiver'} clock assignment`}</h3><table aria-label="${part} witness assignment"><tbody>${Object.entries(witness.assignment[part]).map(([key, q]) => `<tr><th scope="row">${esc(assignmentNames[key] || key)}</th><td>${esc(fraction(q))}${q !== null && key !== 'rate' ? ' µs' : ''}</td></tr>`).join('')}</tbody></table></section>`).join('')}</div><p>“Not used” (null) is preserved from the actual certificate. The current paired-arrival schema deliberately leaves close null; the observed receiver close remains 15000 µs, but no real close event is assigned or checked in this witness.</p><pre>${esc(JSON.stringify(witness, null, 2))}</pre></details>`;
  }
  function renderWorlds() {
    const doc = state.doc;
    if (!twoPass(state.checks, doc) || !threeWorlds(doc)) return;
    $('stage-result').innerHTML = `<div class="result"><div class="result-header"><p class="verdict ambiguous">Ambiguous · three witnesses</p><p class="exact">Δ ∈ [${esc(fraction(doc.interval.lo))}, ${esc(fraction(doc.interval.hi))}] µs</p></div><p class="result-copy">Fresh η = 1000 µs run. Every witness matches the same observations and bounds. A / neutral / B are feasible regions, not a forced global verdict. Choose a world.</p>${checksHTML(state.checks, doc)}<div class="world-tabs" role="group" aria-label="Choose a verified witness">${doc.witnesses.map((w, index) => `<button type="button" data-world="${index}" class="${esc(w.outcome)}" aria-pressed="${state.witness === index}">${esc(REGION_LABELS[w.outcome])}</button>`).join('')}</div><div id="world-content"></div>${observationsDetail(doc)}${evidenceHTML(doc)}</div>`;
    $('stage-result').querySelectorAll('[data-world]').forEach(button => button.addEventListener('click', () => {
      if (state.busy) return;
      state.witness = Number(button.dataset.world);
      $('stage-result').querySelectorAll('[data-world]').forEach(b => b.setAttribute('aria-pressed', String(b === button)));
      renderSelectedWorld(); announce(`${REGION_LABELS[doc.witnesses[state.witness].outcome]} witness selected from the current two-PASS ambiguous certificate.`);
    }));
    renderSelectedWorld();
  }
  function renderSelectedWorld() {
    const witness = state.doc.witnesses[state.witness], real = witness.assignment.real;
    $('world-content').innerHTML = `<section class="world"><h3 class="verdict ${esc(witness.outcome)}">${esc(REGION_LABELS[witness.outcome])} · admissible world</h3><p class="exact">Δ = ${esc(fraction(real.delayDifferenceUs))} µs</p><p>In this witness: delay A = ${esc(fraction(real.delayAUs))} µs · delay B = ${esc(fraction(real.delayBUs))} µs</p>${assignmentHTML(witness)}</section>`;
  }
  async function runTamper(operation) {
    if (!isCurrentOperation(operation)) return;
    const original = state.doc;
    const altered = structuredClone(original);
    const before = altered.witnesses[0].assignment.real.delayAUs;
    altered.witnesses[0].assignment.real.delayAUs = addOneUs(before);
    // WebCrypto cannot be aborted; fence its continuation before publishing or
    // starting /api/verify. Keep the scientific digest helper unchanged.
    const digest = await digestSemantic(altered);
    if (!isCurrentOperation(operation)) return;
    altered.digest = digest;
    announce('Baseline has two PASS results. Exactly +1 µs applied to first witness delay A; canonical SHA-256 recomputed. Calling both verifiers…');
    const result = await request('/api/verify', altered, operation);
    if (!isCurrentOperation(operation)) return;
    state.tampered = altered; state.tamperChecks = result;
    const rejection = twoReject(result), hasError = ['javascript', 'python'].some(k => checkerState(result[k]) === 'ERROR');
    const title = rejection ? 'Semantic edit rejected by both' : hasError ? 'Runtime ERROR · rejection not established' : 'Tamper test did not obtain two REJECTs';
    $('stage-result').innerHTML = `<div class="result"><p id="tamper-outcome" class="verdict ${rejection ? 'reject' : 'error'}">${title}</p><p class="result-copy">Fresh η = 1000 µs baseline: ${esc(LABELS[original.outcome])}, Δ ∈ [${esc(fraction(original.interval.lo))}, ${esc(fraction(original.interval.hi))}] µs, ${original.witnesses.length} witnesses.</p>${checksHTML(state.checks, original, 'Unmodified baseline checks')}<div class="tamper-edit"><span>First witness (${esc(REGION_LABELS[altered.witnesses[0].outcome])})<br>delay A: ${esc(fraction(before))} → ${esc(fraction(altered.witnesses[0].assignment.real.delayAUs))} µs</span><strong>exactly +1 µs</strong></div><p class="result-copy">All other fields unchanged, except the recomputed digest. The witness now breaks its event / delay equations. A hash match alone cannot repair that semantic mismatch.</p>${checksHTML(result, altered, 'Edited document checks')}<p class="result-copy">${rejection ? 'Both verifiers returned semantic REJECT with reasons below their labels. This is a successful tamper rejection—not an accepted race verdict.' : hasError ? 'At least one verifier did not complete a semantic check. Runtime failure does not count as a successful tamper rejection.' : 'Do not claim a successful tamper rejection without two semantic REJECT results.'}</p><details class="evidence"><summary>Compare original / recomputed canonical hashes</summary><p class="hash">Original: ${esc(original.digest)}<br>Edited: ${esc(altered.digest)}</p><p>The digest was recomputed locally from the edited canonical payload before POST /api/verify.</p></details>${evidenceHTML(altered, 'tampered')}</div>`;
    announce(rejection ? 'Both verifiers semantically rejected the rehashed +1 µs edit.' : title, !rejection);
  }
  function renderCampaign() {
    const batch = state.doc, checks = state.checks;
    if (!batch || !twoPass(checks, batch)) {
      $('stage-result').innerHTML = `<div class="result"><p class="notice error">Retained batch not verified. No accepted majority or denominator claim.</p>${checksHTML(checks, batch)}</div>`;
      announce('Retained replay did not obtain two PASS results.', true); return;
    }
    const c = comparison(batch), count = batch.counts;
    const title = batch.decision === 'no-forced-path-majority' ? 'No forced path majority' : batch.decision === 'force-a-majority' ? 'Force A majority' : batch.decision === 'force-b-majority' ? 'Force B majority' : 'Unknown batch decision';
    $('stage-result').innerHTML = `<div class="result"><div class="result-header"><p class="verdict ${batch.decision === 'no-forced-path-majority' ? 'neutral' : batch.decision === 'force-a-majority' ? 'force-a' : 'force-b'}">${esc(title)}</p><p class="exact">N = ${esc(batch.denominator)}</p></div>${checksHTML(checks, batch)}<div class="tally" aria-label="Verified retained race counts">${['force-a', 'neutral', 'force-b', 'ambiguous'].map(k => `<div class="${k}">${LABELS[k]}<b>${esc(count[k])}</b></div>`).join('')}</div><div class="comparison"><article><h3>All retained races · published denominator</h3><p class="ratio force-b">B: ${c.b}/${c.n} = ${c.allPercent}</p><p>Question: What fraction of <strong>all retained races</strong> force B? Strict majority requires 2 × ${c.b} &gt; ${c.n}; here ${2n * c.b} ${2n * c.b > c.n ? '>' : '≤'} ${c.n}.</p></article><article><h3>Conditional · remove only ambiguous races</h3><p class="ratio force-b">B: ${c.b}/${c.conditionalN} = ${c.conditionalPercent}</p><p>N′ = ${c.n} − ${c.ambiguous} = ${c.conditionalN}. Keep Force A, neutral, and Force B. Question: What fraction of <strong>non-ambiguous races</strong> force B?</p></article></div><p class="result-copy">These answer different questions. The conditional result is not intrinsically incorrect; it changes the population and cannot substitute for a claim about all N = ${c.n} retained races. The teaching input is not in this batch.</p>${evidenceHTML(batch)}</div>`;
    announce('Retained batch checked by both verifiers. Counts and decision are from the local replay; percentages use explicitly labeled denominators.');
  }
  async function loadCatalog() {
    try {
      const response = await request('/api/catalog');
      if (!Array.isArray(response.live) || response.live.length !== 5) throw new Error('Expected the five existing LIVE profiles.');
      state.catalog = response;
      $('live-profile').replaceChildren(...response.live.map(item => {
        const option = document.createElement('option'); option.value = item.scenarioId; option.textContent = item.label; return option;
      }));
      describeLive();
      $('catalog-status').textContent = response.python?.ok ? 'Local catalog loaded. Python runtime available; each capture still needs two PASS results.' : `Python runtime not ready: ${response.python?.reason || 'unknown runtime state'}. LIVE acceptance will require two PASS results.`;
    } catch (error) {
      state.catalog = null; $('live-profile').replaceChildren(new Option('LIVE catalog unavailable', ''));
      $('catalog-status').textContent = `Catalog ERROR: ${error.message}. The teaching and retained actions can still be attempted.`;
    } finally { updateControls(); }
  }
  function describeLive() { $('live-description').textContent = state.catalog?.live.find(item => item.scenarioId === $('live-profile').value)?.description || ''; }
  async function runLive() {
    if (state.busy || !state.catalog) return;
    const scenarioId = $('live-profile').value;
    state.live = null;
    const operation = beginOperation('live', 'live-run');
    $('live-result').innerHTML = '<p class="notice result">Capturing fresh loopback traffic. No accepted LIVE result yet.</p>';
    announce('LIVE capture running. This does not change any teaching or retained evidence.');
    try {
      const response = await request('/api/run-live', { scenarioId, epsilonSenderPpm: '200', epsilonReceiverPpm: '200', etaSenderUs: '2', etaReceiverUs: '2', marginUs: '500' }, operation);
      if (!isCurrentOperation(operation)) return;
      if (response.certificate?.source !== 'live-udp' || response.certificate.scenarioId !== scenarioId) throw new Error('Response does not bind the selected LIVE UDP profile.');
      state.live = response;
      $('live-result').innerHTML = verifiedRaceHTML(response.certificate, response.checks, 'live');
      if(twoPass(response.checks,response.certificate)) {
        const capture=response.certificate.capture;
        if(!Array.isArray(capture?.events) || capture.events.length===0)throw new Error('LIVE capture has no recorded events.');
        const details=document.createElement('details');details.className='evidence';details.open=true;
        const summary=document.createElement('summary');summary.textContent='Captured sender, relay and receiver events';
        const note=document.createElement('p');note.textContent='Times below share the local capture process\'s monotonic origin (µs). They are separate from the projected endpoint-clock readings. This is loopback acquisition, not radio-path performance.';
        const table=document.createElement('table');table.setAttribute('aria-label','Actual LIVE capture events');
        const head=document.createElement('thead');const header=document.createElement('tr');
        for(const label of ['Capture time (µs)','Event','Path / status']){const th=document.createElement('th');th.textContent=label;header.append(th);}head.append(header);
        const body=document.createElement('tbody');
        for(const event of capture.events){const row=document.createElement('tr');for(const value of [event.monotonicUs,event.type,[event.round,event.path,event.status,event.reason].filter(Boolean).join(' / ')]){const cell=document.createElement('td');cell.textContent=value;row.append(cell);}body.append(row);}
        table.append(head,body);details.append(summary,note,table);$('live-result').querySelector('.result').append(details);
      }
      attachDownloads($('live-result'));
      announce(twoPass(response.checks, response.certificate) ? 'Fresh LIVE capture has two PASS results. Timings and verdicts can vary.' : 'LIVE result not accepted: two PASS results required.', !twoPass(response.checks, response.certificate));
    } catch (error) {
      if (!isCurrentOperation(operation)) return;
      state.live = null;
      $('live-result').innerHTML = `<p class="notice error result">LIVE runtime ERROR: ${esc(error.message)}. No accepted LIVE verdict.</p>`;
      announce('LIVE capture failed. No verified LIVE claim.', true);
    } finally { finishOperation(operation); }
  }
  $('workflow-previous').addEventListener('click', () => chooseStep(state.step - 1));
  $('workflow-next').addEventListener('click', () => chooseStep(state.step + 1));
  $('workflow-action').addEventListener('click', runCurrentAction);
  $('workflow-cancel').addEventListener('click', cancelRun);
  $('workflow-restart').addEventListener('click', () => chooseStep(0, true));
  $('workflow-help').addEventListener('click', () => {
    if (state.busy) return;
    const open = $('workflow-help').getAttribute('aria-expanded') !== 'true';
    $('workflow-help').setAttribute('aria-expanded', String(open));
    $('workflow-help-content').hidden = !open;
  });
  $('presenter-toggle').addEventListener('click', () => {
    if (state.busy) return;
    const pressed = document.body.classList.toggle('presenter-view');
    $('presenter-toggle').setAttribute('aria-pressed', String(pressed));
    focusAndReveal($('presenter-toggle'));
  });
  document.addEventListener('keydown', event => {
    if (event.defaultPrevented || event.isComposing || event.keyCode === 229) return;
    const key = event.key;
    if (!['ArrowLeft', 'ArrowRight', 'Enter', 'r', 'R'].includes(key)) return;
    const path = event.composedPath();
    // Leave native editing, selection and editable descendants entirely alone.
    if (path.some(el => el instanceof Element && (el.matches('input, textarea, select, [role="textbox"], [role="combobox"], [role="searchbox"]') || el.isContentEditable))) return;
    if (event.altKey || event.ctrlKey || event.metaKey || event.shiftKey) return;
    if (state.busy || event.repeat) {
      // While busy, allow only native, non-repeated Enter on Cancel. All step
      // shortcuts stay blocked; Space and Tab retain their native behavior.
      if (state.busy && !event.repeat && key === 'Enter' && path.includes($('workflow-cancel')) && !$('workflow-cancel').disabled) return;
      event.preventDefault(); return;
    }
    // Enter on a native control activates only that control, not the step too.
    if (key === 'Enter' && path.some(el => el instanceof Element && el.matches('button, a, summary, [role="button"], [role="link"]'))) return;
    event.preventDefault();
    if (key === 'ArrowLeft') chooseStep(state.step - 1);
    else if (key === 'ArrowRight') chooseStep(state.step + 1);
    else if (key === 'Enter') runCurrentAction();
    else chooseStep(0, true);
  });
  document.querySelectorAll('[data-step]').forEach(button => button.addEventListener('click', () => chooseStep(Number(button.dataset.step))));
  $('live-profile').addEventListener('change', () => {
    if (state.busy) return;
    state.live = null; $('live-result').replaceChildren(); describeLive(); announce('LIVE profile changed. Previous LIVE claim cleared; capture fresh traffic.');
  });
  $('live-run').addEventListener('click', runLive);
  renderStep(); announce('Inspect the fixed illustrative log. Choose a step; nothing runs automatically.');
  loadCatalog(); // Catalog metadata only. No producer, verifier, or LIVE action is auto-run.
}

if (typeof module !== 'undefined' && module.exports) module.exports = { ETA_PRESETS, teachingInput, canonical, digestSemantic, addOneUs, checkerState, twoPass, twoReject, fraction, percent, comparison };
if (typeof document !== 'undefined') startGuided();
