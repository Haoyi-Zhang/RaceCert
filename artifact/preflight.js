'use strict';

const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const { spawn, spawnSync } = require('node:child_process');
const { verifyDocument } = require('./verifier-js');
const { probePythonVerifier, runPythonVerifier } = require('./python-runner');

const root = __dirname;
const report = { ok: false, checks: [] };
const jsonMode = process.argv.includes('--json');
function message(value) { if (!jsonMode) process.stdout.write(value + '\n'); }
function passed(name) { report.checks.push(name); message('PASS: ' + name); }

async function localServerCheck() {
  const child = spawn(process.execPath, [path.join(root, 'server.js')], {
    cwd: root, env: { ...process.env, PORT: process.env.PORT || '8765', RACECERT_NO_BROWSER: '1' },
    windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'],
  });
  let stderr = '';
  child.stderr.on('data', value => { stderr += value; });
  const closed = new Promise(resolve => child.once('close', resolve));
  try {
    const url = await new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('Local server did not become ready. ' + stderr.trim())), 15000);
      child.on('error', error => { clearTimeout(timer); reject(error); });
      child.on('exit', code => { clearTimeout(timer); reject(new Error('Local server exited: ' + code + '. ' + stderr.trim())); });
      child.stdout.on('data', value => {
        const match = String(value).match(/http:\/\/127\.0\.0\.1:\d+/);
        if (match) { clearTimeout(timer); resolve(match[0]); }
      });
    });
    const fetchLocal = async (route, options = {}) => {
      const response = await fetch(url + route, { ...options, signal: AbortSignal.timeout(15000) });
      if (!response.ok) throw new Error('Local route ' + route + ' returned HTTP ' + response.status);
      return response;
    };
    const catalog = await (await fetchLocal('/api/catalog')).json();
    assert.equal(catalog.frozen.length, 6); assert.equal(catalog.live.length, 5); assert.equal(catalog.python.ok, true);
    const html = await (await fetchLocal('/')).text();
    assert.ok(html.includes('RaceCert') && html.includes('guided.js') && html.includes('id="workflow-action"'));
    const advanced = await (await fetchLocal('/index.html')).text();
    assert.ok(advanced.includes('Run and certify') && advanced.includes('Replay retained 512 races'));
    const boundary = catalog.frozen.find(item => item.scenarioId === 'censored-boundary');
    const result = await (await fetchLocal('/api/run-frozen', {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(boundary),
    })).json();
    assert.equal(result.checks.javascript.ok, true); assert.equal(result.checks.python.ok, true);
    assert.equal(result.certificate.outcome, 'ambiguous');
    assert.deepEqual(result.certificate.feasible, ['force-a', 'neutral']);
    const campaign = await (await fetchLocal('/api/campaign')).json();
    assert.equal(campaign.checks.javascript.ok, true); assert.equal(campaign.checks.python.ok, true);
    assert.equal(campaign.batch.denominator, '512');
    const guided = await (await fetchLocal('/guided.html')).text();
    assert.ok(guided.includes('RaceCert') && guided.includes('guided.js'));
    const {input} = require('./tests/presentation-cases.cjs');
    for(const eta of ['0','1000']) {
      const teaching = await (await fetchLocal('/api/run-frozen', {
        method:'POST', headers:{'content-type':'application/json'},
        body:JSON.stringify({...input,etaSenderUs:eta,etaReceiverUs:eta}),
      })).json();
      assert.equal(teaching.checks.javascript.ok,true);assert.equal(teaching.checks.python.ok,true);
      assert.equal(teaching.certificate.outcome,eta==='0'?'force-b':'ambiguous');
    }
    report.localUrl = url;
  } finally {
    child.kill();
    await closed;
  }
}

async function main() {
  message('RaceCert Demo #95 - local preflight');
  assert.ok(Number(process.versions.node.split('.')[0]) >= 20, 'Node.js 20+ is required.');
  const python = probePythonVerifier();
  assert.equal(python.ok, true, python.reason);
  report.node = process.version; report.python = python.runtime; report.pythonCommand = python.command;
  message('Node ' + process.version + '; ' + python.runtime);
  message('Python interpreter: ' + python.command);
  passed('runtime discovery');

  const tests = spawnSync(process.execPath, [path.join(root, 'tests/run-tests.js')], {
    cwd: root, env: process.env, encoding: 'utf8', timeout: 45000, maxBuffer: 4 * 1024 * 1024, windowsHide: true,
  });
  if (tests.error || tests.status !== 0) throw new Error('Fixture/profile tests failed. ' + (tests.error?.message || tests.stderr.trim() || tests.stdout.trim()));
  const testSummary = JSON.parse(tests.stdout.trim());
  assert.equal(testSummary.ok, true);
  assert.equal(testSummary.mockedUdpInitializationFaults, '5');
  assert.equal(testSummary.mockedUdpRuntimeFaults, '2');
  report.fixtureTests = testSummary;
  passed('6 frozen fixtures, 5 live UDP profiles, widening and rehashed rejection tests');
  const examples = spawnSync(process.execPath,[path.join(root,'tests/presentation-cases.cjs')],{
    cwd:root,env:process.env,encoding:'utf8',timeout:15000,maxBuffer:4*1024*1024,windowsHide:true,
  });
  if(examples.error || examples.status!==0)throw new Error('Presentation case tests failed. '+(examples.error?.message || examples.stderr));
  report.presentationCases=JSON.parse(examples.stdout.trim());
  assert.equal(report.presentationCases.ok,true);
  passed('controlled presentation case, exact error thresholds and one-microsecond rejection');

  const batch = JSON.parse(fs.readFileSync(path.join(root, 'results/campaign-batch.json'), 'utf8'));
  const js = verifyDocument(batch), py = runPythonVerifier(batch);
  assert.equal(js.ok, true, js.reason); assert.equal(py.ok, true, py.reason);
  assert.equal(batch.denominator, '512'); assert.equal(batch.certificates.length, 512);
  assert.deepEqual(batch.counts, { 'force-a': '176', neutral: '12', 'force-b': '191', ambiguous: '133' });
  assert.equal(batch.decision, 'no-forced-path-majority');
  report.campaign = { counts: batch.counts, denominator: batch.denominator, decision: batch.decision };
  passed('retained 512-race batch accepted by JavaScript and Python');

  await localServerCheck();
  passed('local HTTP endpoints: page, boundary certificate and retained batch');
  report.ok = true;
  message('CHECK PASSED. Start the presentation with START_DEMO.cmd.');
  message('The temporary self-test server has stopped. Monitor, cables and spoken timing still need rehearsal.');
  message('This check does not execute browser interactions. Rehearse those on the presentation laptop.');
  if (jsonMode) process.stdout.write(JSON.stringify(report) + '\n');
}

main().catch(error => {
  report.error = error.message;
  if (jsonMode) process.stdout.write(JSON.stringify(report) + '\n');
  else process.stderr.write('CHECK FAILED: ' + error.message + '\nDo not present this as a passed check. Keep the message for diagnosis.\n');
  process.exitCode = 1;
});
