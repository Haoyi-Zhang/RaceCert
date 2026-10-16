'use strict';
// Rebuilt 2026-10-13. Standalone verifier: no producer imports or construction.
const crypto = require('node:crypto');
const fs = require('node:fs');
function need(ok, message) { if (!ok) throw new Error(message); }
function keys(value, expected, label) {
  need(value && typeof value === 'object' && !Array.isArray(value), `${label}: object required`);
  need(Object.keys(value).sort().join('|') === expected.slice().sort().join('|'), `${label}: schema fields differ`);
}
function integer(s) { need(typeof s === 'string' && /^-?\d+$/.test(s), 'decimal integer string required'); return BigInt(s); }
function gcd(a,b) { a=a<0n?-a:a; b=b<0n?-b:b; while(b) { const r=a%b; a=b; b=r; } return a || 1n; }
// Pairs rather than the producer's Rat class; cross products are exact.
function q(n,d=1n) { need(d!==0n,'zero denominator'); if(d<0n){n=-n;d=-d;} const g=gcd(n,d); return [n/g,d/g]; }
const add=(a,b)=>q(a[0]*b[1]+b[0]*a[1],a[1]*b[1]);
const sub=(a,b)=>q(a[0]*b[1]-b[0]*a[1],a[1]*b[1]);
const mul=(a,b)=>q(a[0]*b[0],a[1]*b[1]);
const div=(a,b)=>q(a[0]*b[1],a[1]*b[0]);
const cmp=(a,b)=>{const n=a[0]*b[1]-b[0]*a[1];return n<0n?-1:n>0n?1:0;};
const eq=(a,b)=>cmp(a,b)===0;
const neg=a=>[-a[0],a[1]];
const zero=q(0n);
function readQ(o) {
  keys(o,['n','d'],'rational'); const n=integer(o.n),d=integer(o.d);
  need(d>0n && gcd(n,d)===1n && n.toString()===o.n && d.toString()===o.d,'rational must be reduced with positive denominator'); return [n,d];
}
function canonical(v) {
  if(Array.isArray(v)) return '['+v.map(canonical).join(',')+']';
  if(v && typeof v==='object') return '{'+Object.keys(v).sort().map(k=>JSON.stringify(k)+':'+canonical(v[k])).join(',')+'}';
  need(v===null || typeof v==='string' || typeof v==='boolean','non-schema numeric or unsupported value'); return JSON.stringify(v);
}
function digest(document) {
  const semantic={...document}; delete semantic.digest;
  need(typeof document.digest==='string' && /^[a-f0-9]{64}$/.test(document.digest),'invalid digest encoding');
  need(crypto.createHash('sha256').update(canonical(semantic)).digest('hex')===document.digest,'digest mismatch');
}
function hull(x,ppm,eta) {
  // Enumerate the four extreme affine clock constraints independently.
  const values=[];
  for(const error of [-2n*eta,2n*eta]) for(const rate of [1000000n-ppm,1000000n+ppm]) values.push(q((x-error)*1000000n,rate));
  values.sort(cmp); return [values[0],values.at(-1)];
}
const region=(z,m)=>cmp(z,neg(m))<0?'force-a':cmp(z,m)>0?'force-b':'neutral';
function witness(w,obs,budgets,interval,margin,kind) {
  keys(w,['outcome','assignment'],'witness'); keys(w.assignment,['sender','receiver','real'],'assignment');
  const endpoints={};
  for(const [name,ppm,eta] of [['sender',budgets.epsilonSenderPpm,budgets.etaSenderUs],['receiver',budgets.epsilonReceiverPpm,budgets.etaReceiverUs]]) {
    const e=w.assignment[name]; keys(e,['rate','offsetUs','readErrorAUs','readErrorBUs','readErrorCloseUs'],name);
    const r={}; for(const key of Object.keys(e)) r[key]=e[key]===null?null:readQ(e[key]);
    need(r.rate && r.offsetUs && cmp(r.rate,q(1000000n-ppm,1000000n))>=0 && cmp(r.rate,q(1000000n+ppm,1000000n))<=0,`${name} rate outside budget`);
    for(const key of ['readErrorAUs','readErrorBUs','readErrorCloseUs']) if(r[key]) need(cmp(r[key],q(-eta))>=0 && cmp(r[key],q(eta))<=0,`${name} read error outside budget`);
    endpoints[name]=r;
  }
  const names=['sendAUs','sendBUs','receiveAUs','receiveBUs','closeUs','delayAUs','delayBUs','delayDifferenceUs','completionWaitAUs','completionWaitBUs'];
  keys(w.assignment.real,names,'real');
  const t={}; for(const k of names) t[k]=w.assignment.real[k]===null?null:readQ(w.assignment.real[k]);
  for(const k of names.filter(k=>k!=='closeUs')) need(t[k]!==null,`missing ${k}`);
  for(const k of ['sendAUs','sendBUs','receiveAUs','receiveBUs','delayAUs','delayBUs','completionWaitAUs','completionWaitBUs']) need(cmp(t[k],zero)>=0,`negative ${k}`);
  need(eq(sub(t.receiveAUs,t.sendAUs),t.delayAUs) && eq(sub(t.receiveBUs,t.sendBUs),t.delayBUs),'delay equations fail');
  need(eq(sub(t.delayAUs,t.delayBUs),t.delayDifferenceUs),'delay difference equation fails');
  need(region(t.delayDifferenceUs,margin)===w.outcome,'witness policy region fails');
  need((interval[0]===null || cmp(t.delayDifferenceUs,interval[0])>=0) && (interval[1]===null || cmp(t.delayDifferenceUs,interval[1])<=0),'witness outside interval');
  function clock(endpoint,error,time,recorded) {
    need(error!==null && eq(add(add(mul(endpoint.rate,time),endpoint.offsetUs),error),q(recorded)),'affine clock equation fails');
  }
  const s=endpoints.sender,r=endpoints.receiver;
  need(s.readErrorCloseUs===null,'sender has no close observation');
  clock(s,s.readErrorAUs,t.sendAUs,obs.sendAUs); clock(s,s.readErrorBUs,t.sendBUs,obs.sendBUs);
  for(const path of ['A','B']) {
    const observation=obs['recv'+path+'Us'],error=r['readError'+path+'Us'];
    if(observation===null) need(error===null,'censored arrival has a read error');
    else clock(r,error,t['receive'+path+'Us'],observation);
  }
  if(kind==='paired-arrivals') {
    need(t.closeUs===null && r.readErrorCloseUs===null,'paired witness must not invent a close reading');
    need(eq(t.completionWaitAUs,zero) && eq(t.completionWaitBUs,zero),'paired completion waits must be zero');
  } else {
    need(t.closeUs!==null && cmp(t.closeUs,zero)>=0,'censored close missing or negative'); clock(r,r.readErrorCloseUs,t.closeUs,obs.closeUs);
    for(const path of ['A','B']) {
      const received=t['receive'+path+'Us'],wait=t['completionWait'+path+'Us'];
      if(obs['recv'+path+'Us']===null) need(cmp(received,t.closeUs)>=0 && eq(wait,sub(received,t.closeUs)),'censored event order/wait fails');
      else need(cmp(received,t.closeUs)<=0 && eq(wait,zero),'observed arrival order/wait fails');
    }
  }
}
function race(c) {
  keys(c,['schema','scenarioId','source','capture','evidenceKind','assumptions','observations','interval','outcome','feasible','witnesses','digest'],'race'); digest(c);
  need(c.schema==='racecert-v2' && typeof c.scenarioId==='string' && c.scenarioId.length>0,'race identity invalid');
  need(['live-udp','frozen-deterministic'].includes(c.source),'unknown source');
  need(c.capture && typeof c.capture==='object' && !Array.isArray(c.capture),'capture declaration required');
  const assumptionNames=['epsilonSenderPpm','epsilonReceiverPpm','etaSenderUs','etaReceiverUs','marginUs']; keys(c.assumptions,assumptionNames,'assumptions');
  const a={}; for(const k of assumptionNames) { a[k]=integer(c.assumptions[k]); need(a[k]>=0n,'negative budget'); }
  need(a.epsilonSenderPpm<1000000n && a.epsilonReceiverPpm<1000000n,'rate budget invalid');
  keys(c.observations,['sendAUs','sendBUs','recvAUs','recvBUs','closeUs'],'observations'); const o={};
  for(const k of Object.keys(c.observations)) o[k]=c.observations[k]===null?null:integer(c.observations[k]);
  need(o.sendAUs!==null && o.sendBUs!==null && o.closeUs!==null,'missing send/close observation');
  if(c.capture.observations) need(canonical(c.capture.observations)===canonical(c.observations),'capture observation binding fails');
  const sh=hull(o.sendAUs-o.sendBUs,a.epsilonSenderPpm,a.etaSenderUs);
  let i,kind;
  if(o.recvAUs!==null && o.recvBUs!==null) {
    const rh=hull(o.recvAUs-o.recvBUs,a.epsilonReceiverPpm,a.etaReceiverUs); i=[sub(rh[0],sh[1]),sub(rh[1],sh[0])]; kind='paired-arrivals';
  } else if(o.recvAUs!==null) {
    const h=hull(o.recvAUs-o.closeUs,a.epsilonReceiverPpm,a.etaReceiverUs); need(cmp(h[0],zero)<=0,'A cannot precede close');
    i=[null,sub(cmp(h[1],zero)<0?h[1]:zero,sh[0])]; kind='a-only-censored';
  } else if(o.recvBUs!==null) {
    const h=hull(o.closeUs-o.recvBUs,a.epsilonReceiverPpm,a.etaReceiverUs); need(cmp(h[1],zero)>=0,'B cannot precede close');
    i=[sub(cmp(h[0],zero)>0?h[0]:zero,sh[1]),null]; kind='b-only-censored';
  } else { i=[null,null];kind='no-arrival'; }
  need(c.evidenceKind===kind,'evidence kind mismatch'); keys(c.interval,['lo','hi','loClosed','hiClosed'],'interval');
  need(c.interval.loClosed==='true' && c.interval.hiClosed==='true','interval closure mismatch');
  for(const [n,k] of [[0,'lo'],[1,'hi']]) need(i[n]===null?c.interval[k]===null:c.interval[k]!==null && eq(i[n],readQ(c.interval[k])),'interval mismatch');
  const m=q(a.marginUs),feasible=[];
  if(i[0]===null || cmp(i[0],neg(m))<0) feasible.push('force-a');
  if((i[0]===null || cmp(i[0],m)<=0) && (i[1]===null || cmp(i[1],neg(m))>=0)) feasible.push('neutral');
  if(i[1]===null || cmp(i[1],m)>0) feasible.push('force-b');
  const outcome=feasible.length===1?feasible[0]:'ambiguous';
  need(c.outcome===outcome,'outcome mismatch'); need(canonical(c.feasible)===canonical(feasible),'feasible region set mismatch');
  need(Array.isArray(c.witnesses),'witness array required'); const expected=outcome==='ambiguous'?feasible:[];
  need(canonical(c.witnesses.map(w=>w.outcome))===canonical(expected),'complete witness set mismatch');
  for(const w of c.witnesses) witness(w,o,a,i,m,kind);
  return {ok:true,kind:'race',digest:c.digest,outcome,witnessesVerified:c.witnesses.length};
}
function batch(c) {
  keys(c,['schema','batchId','denominator','certificateDigests','counts','decision','certificates','digest'],'batch'); digest(c);
  need(typeof c.batchId==='string' && Array.isArray(c.certificates) && c.certificates.length>0,'invalid batch');
  need(integer(c.denominator)===BigInt(c.certificates.length),'fixed denominator mismatch');
  const counts={'force-a':0n,neutral:0n,'force-b':0n,ambiguous:0n};
  for(const r of c.certificates) { race(r); counts[r.outcome]++; }
  need(canonical(c.certificateDigests)===canonical(c.certificates.map(r=>r.digest)),'constituent digest binding mismatch');
  keys(c.counts,Object.keys(counts),'counts'); for(const k of Object.keys(counts)) need(integer(c.counts[k])===counts[k],'batch count mismatch');
  const n=BigInt(c.certificates.length),decision=2n*counts['force-a']>n?'force-a-majority':2n*counts['force-b']>n?'force-b-majority':'no-forced-path-majority';
  need(c.decision===decision,'batch majority mismatch'); return {ok:true,kind:'batch',digest:c.digest,denominator:c.denominator,decision,racesVerified:c.certificates.length};
}
function verifyDocument(c) { try { return c?.schema==='racecert-batch-v1'?batch(c):race(c); } catch(e) { return {ok:false,reason:e.message}; } }
if(require.main===module) {
  try { const c=JSON.parse(fs.readFileSync(process.argv[2] || 0,'utf8')); const r=verifyDocument(c); console.log(JSON.stringify(r)); process.exitCode=r.ok?0:1; }
  catch(e) { console.log(JSON.stringify({ok:false,reason:e.message}));process.exitCode=1; }
}
module.exports={verifyDocument};
