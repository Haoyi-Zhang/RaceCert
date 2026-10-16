'use strict';

const fs = require('node:fs');
const http = require('node:http');
const path = require('node:path');
const { computeRace, aggregateCertificates } = require('./producer');
const { verifyDocument } = require('./verifier-js');
const { runPythonVerifier, probePythonVerifier } = require('./python-runner');
const { runLiveCapture } = require('./udp-transport');

const root = __dirname;
const frozen = JSON.parse(fs.readFileSync(path.join(root, 'scenarios.json'), 'utf8'));
const live = JSON.parse(fs.readFileSync(path.join(root, 'live-profiles.json'), 'utf8'));
const mime = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.json': 'application/json; charset=utf-8' };

function body(request) {
  return new Promise((resolve, reject) => {
    let data = '';
    request.on('data', (chunk) => { data += chunk; if (data.length > 8_000_000) request.destroy(new Error('request too large')); });
    request.on('end', () => { try { resolve(JSON.parse(data || '{}')); } catch (error) { reject(error); } });
    request.on('error', reject);
  });
}
function json(response, status, value) { response.writeHead(status, { 'content-type': mime['.json'], 'cache-control': 'no-store' }); response.end(JSON.stringify(value)); }
function checks(document) { return { javascript: verifyDocument(document), python: runPythonVerifier(document) }; }

const server = http.createServer(async (request, response) => {
  try {
    const pathname = new URL(request.url, 'http://127.0.0.1').pathname;
    if (request.method === 'GET' && pathname === '/api/catalog') return json(response, 200, { frozen, live, build: 'racecert-demo-v2', python: probePythonVerifier() });
    if (request.method === 'GET' && pathname === '/api/campaign') {
      const batch = JSON.parse(fs.readFileSync(path.join(root, 'results', 'campaign-batch.json'), 'utf8'));
      return json(response, 200, { batch, checks: checks(batch) });
    }
    if (request.method === 'POST' && pathname === '/api/run-frozen') {
      const input = await body(request);
      const certificate = computeRace(input);
      return json(response, 200, { certificate, checks: checks(certificate) });
    }
    if (request.method === 'POST' && pathname === '/api/run-live') {
      const selection = await body(request);
      const profile = live.find((item) => item.scenarioId === selection.scenarioId);
      if (!profile) throw new Error('unknown live profile');
      const captureInput = await runLiveCapture(profile);
      for (const key of ['epsilonSenderPpm','epsilonReceiverPpm','etaSenderUs','etaReceiverUs','marginUs']) if (selection[key] !== undefined) captureInput[key] = selection[key];
      const certificate = computeRace(captureInput);
      return json(response, 200, { certificate, checks: checks(certificate) });
    }
    if (request.method === 'POST' && pathname === '/api/verify') {
      const document = await body(request);
      return json(response, 200, checks(document));
    }
    if (request.method === 'POST' && pathname === '/api/aggregate') {
      const payload = await body(request);
      const batch = aggregateCertificates(payload.certificates, payload.batchId || 'interactive-batch');
      return json(response, 200, { batch, checks: checks(batch) });
    }
    const requestPath = pathname === '/' ? '/guided.html' : pathname;
    const resolved = path.resolve(root, 'public', `.${requestPath}`);
    const publicRoot = path.resolve(root, 'public') + path.sep;
    if (!resolved.startsWith(publicRoot)) throw new Error('invalid path');
    const content = fs.readFileSync(resolved);
    response.writeHead(200, { 'content-type': mime[path.extname(resolved)] || 'application/octet-stream', 'cache-control': 'no-store' });
    response.end(content);
  } catch (error) {
    json(response, 400, { error: error.message });
  }
});

function listen(startPort) {
  let port = startPort;
  const maximum = startPort + 20;
  function attempt() {
    const onError = (error) => {
      server.off('listening', onListening);
      if (error.code === 'EADDRINUSE' && port < maximum) { port += 1; attempt(); return; }
      process.stderr.write(`${error.stack}\n`); process.exitCode = 1;
    };
    const onListening = () => {
      server.off('error', onError);
      const address = server.address();
      process.stdout.write(`RaceCert demo v2: http://127.0.0.1:${address.port}\n`);
      if (address.port !== startPort) process.stdout.write(`Requested port ${startPort} was busy; selected ${address.port}.\n`);
    };
    server.once('error', onError);
    server.once('listening', onListening);
    server.listen(port, '127.0.0.1');
  }
  attempt();
}

const requested = Number(process.env.PORT || process.argv[2] || 8765);
if (!Number.isInteger(requested) || requested < 1024 || requested > 65515) throw new Error('PORT must be an integer from 1024 through 65515');
listen(requested);
