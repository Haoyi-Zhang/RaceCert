'use strict';

const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const { computeRace, aggregateCertificates, canonical } = require('./producer');
const { verifyDocument } = require('./verifier-js');
const { runPythonVerifier } = require('./python-runner');

function parsePositiveInteger(value, fallback) {
  if (value === undefined) return fallback;
  if (!/^\d+$/.test(value)) throw new Error('campaign runs must be a positive integer');
  const result = Number(value);
  if (!Number.isSafeInteger(result) || result < 1 || result > 100_000) throw new Error('campaign runs outside 1..100000');
  return result;
}

class Generator {
  constructor(seed) { this.state = BigInt(seed) & ((1n << 64n) - 1n); }
  next() {
    let x = this.state;
    x ^= x << 13n; x ^= x >> 7n; x ^= x << 17n;
    this.state = x & ((1n << 64n) - 1n);
    return this.state;
  }
  integer(minimum, maximum) { return minimum + Number(this.next() % BigInt(maximum - minimum + 1)); }
}

function fixture(index, random) {
  const sendB = random.integer(50, 2500);
  const delayA = random.integer(1000, 15000);
  const delayB = random.integer(1000, 15000);
  const mode = random.integer(0, 4);
  let close = random.integer(6000, 18000);
  let recvA = delayA;
  let recvB = sendB + delayB;
  if (mode === 1) { recvB = null; close = Math.max(close, recvA + 100); }
  if (mode === 2) { recvA = null; close = Math.max(close, recvB + 100); }
  if (mode === 3) { recvA = null; recvB = null; }
  return {
    scenarioId: `campaign-${String(index).padStart(5, '0')}`,
    source: 'frozen-deterministic',
    sendAUs: '0', sendBUs: String(sendB), recvAUs: recvA === null ? null : String(recvA), recvBUs: recvB === null ? null : String(recvB), closeUs: String(close),
    epsilonSenderPpm: String(random.integer(0, 1000)), epsilonReceiverPpm: String(random.integer(0, 1000)),
    etaSenderUs: String(random.integer(0, 20)), etaReceiverUs: String(random.integer(0, 20)), marginUs: String(random.integer(100, 1000)),
    capture: { kind: 'campaign-fixture', generator: 'xorshift64-v1', seed: '20260812', index: String(index), observations: { sendAUs: '0', sendBUs: String(sendB), recvAUs: recvA === null ? null : String(recvA), recvBUs: recvB === null ? null : String(recvB), closeUs: String(close) } },
  };
}

function shaFile(file) { return crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex'); }

function runCampaign(options = {}) {
  const runs = parsePositiveInteger(options.runs, 512);
  const output = options.output || path.join(__dirname, 'results');
  const random = new Generator(20260812n);
  const inputs = [];
  const certificates = [];
  for (let index = 0; index < runs; index += 1) {
    const input = fixture(index, random);
    inputs.push(input);
    const certificate = computeRace(input);
    const check = verifyDocument(certificate);
    if (!check.ok) throw new Error(`JS verifier rejected campaign fixture ${index}: ${check.reason}`);
    certificates.push(certificate);
  }
  const batch = aggregateCertificates(certificates, `campaign-xorshift64-20260812-${runs}`);
  const js = verifyDocument(batch);
  if (!js.ok) throw new Error(`JS verifier rejected campaign batch: ${js.reason}`);
  const python = runPythonVerifier(batch);
  if (!python.ok) throw new Error(`Python verifier rejected campaign batch: ${python.reason}`);
  const summary = {
    schema: 'racecert-campaign-summary-v1',
    generator: 'xorshift64-v1', seed: '20260812', runs: String(runs),
    counts: batch.counts, decision: batch.decision, batchDigest: batch.digest,
    jsVerifier: js, pythonVerifier: python,
    claims: ['exact BigInt producer', 'independent JS verifier', 'independent Python Fraction verifier', 'complete witness verification', 'fixed-denominator aggregation'],
  };
  fs.mkdirSync(output, { recursive: true });
  const rawFile = path.join(output, 'campaign-raw.jsonl');
  const batchFile = path.join(output, 'campaign-batch.json');
  const summaryFile = path.join(output, 'campaign-summary.json');
  fs.writeFileSync(rawFile, inputs.map((input, index) => canonical({ input, certificate: certificates[index] })).join('\n') + '\n');
  fs.writeFileSync(batchFile, JSON.stringify(batch, null, 2) + '\n');
  fs.writeFileSync(summaryFile, JSON.stringify(summary, null, 2) + '\n');
  const manifest = {
    schema: 'racecert-result-manifest-v1',
    files: [rawFile, batchFile, summaryFile].map((file) => ({ file: path.basename(file), bytes: String(fs.statSync(file).size), sha256: shaFile(file) })),
  };
  fs.writeFileSync(path.join(output, 'manifest.json'), JSON.stringify(manifest, null, 2) + '\n');
  return { summary, manifest };
}

if (require.main === module) {
  try {
    const runs = process.argv.includes('--runs') ? process.argv[process.argv.indexOf('--runs') + 1] : undefined;
    const output = process.argv.includes('--output') ? path.resolve(process.argv[process.argv.indexOf('--output') + 1]) : undefined;
    process.stdout.write(`${JSON.stringify(runCampaign({ runs, output }))}\n`);
  } catch (error) {
    process.stderr.write(`${error.stack}\n`); process.exitCode = 1;
  }
}

module.exports = { runCampaign };
