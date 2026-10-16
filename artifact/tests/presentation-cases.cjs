'use strict';
const fs=require('node:fs');
const path=require('node:path');
const assert=require('node:assert/strict');
const {computeRace,canonical,digestSemantic}=require('../producer');
const {verifyDocument}=require('../verifier-js');
const {runPythonVerifier}=require('../python-runner');
const {teachingInput}=require('../public/guided.js');
const input=teachingInput('0');
assert.deepEqual([input.sendAUs,input.sendBUs,input.recvAUs,input.recvBUs,input.closeUs],['0','4000','10000','12000','15000']);
function certify(eta){
 const observations={...input,etaSenderUs:String(eta),etaReceiverUs:String(eta)};
 const certificate=computeRace(observations);
 const js=verifyDocument(certificate),python=runPythonVerifier(certificate);
 assert.equal(js.ok,true,js.reason);assert.equal(python.ok,true,python.reason);
 assert.equal(canonical(certificate),canonical(computeRace(observations)));
 assert.deepEqual(certificate.interval.lo,{n:String(2000-4*eta),d:'1'});
 assert.deepEqual(certificate.interval.hi,{n:String(2000+4*eta),d:'1'});
 return {etaUs:String(eta),observations,certificate,checks:{javascript:js,python}};
}
function main(){
 const sweep=[0,249,250,750,751,1000].map(certify);
 assert.equal(sweep[0].certificate.outcome,'force-b');
 assert.equal(sweep[1].certificate.outcome,'force-b');
 for(const index of [2,3])assert.deepEqual(sweep[index].certificate.feasible,['neutral','force-b']);
 for(const index of [4,5])assert.deepEqual(sweep[index].certificate.feasible,['force-a','neutral','force-b']);
 const wide=sweep.at(-1).certificate;
 assert.deepEqual(wide.witnesses.map(w=>w.assignment.real.delayDifferenceUs),[{n:'-1500',d:'1'},{n:'0',d:'1'},{n:'3500',d:'1'}]);
 const changed=structuredClone(wide);
 const before=structuredClone(changed.witnesses[0].assignment.real.delayAUs);
 changed.witnesses[0].assignment.real.delayAUs={n:(BigInt(before.n)+BigInt(before.d)).toString(),d:before.d};
 delete changed.digest;changed.digest=digestSemantic(changed);
 const js=verifyDocument(changed),python=runPythonVerifier(changed);
 assert.equal(js.ok,false);assert.notEqual(python.runtime,'unavailable',python.reason);assert.equal(python.ok,false);
 assert.equal(js.reason,'delay equations fail');assert.equal(python.reason,'delay equations fail');
 const campaign=JSON.parse(fs.readFileSync(path.join(__dirname,'../results/campaign-batch.json'),'utf8'));
 const resolved=BigInt(campaign.denominator)-BigInt(campaign.counts.ambiguous),b=BigInt(campaign.counts['force-b']);
 assert.equal(resolved,379n);assert.ok(2n*b>resolved);assert.ok(2n*b<BigInt(campaign.denominator));
 const evidence={schema:'racecert-presentation-evidence-v1',scope:'Controlled illustrative inputs added for the presentation; separate from the six published fixtures and retained 512-race campaign. No physical network experiment is claimed.',sweep,oneMicrosecondMutation:{field:'witnesses[0].assignment.real.delayAUs',before,after:changed.witnesses[0].assignment.real.delayAUs,rehashDigest:changed.digest,checks:{javascript:js,python}},denominatorComparison:{forceB:campaign.counts['force-b'],allRaces:campaign.denominator,ambiguousExcluded:campaign.counts.ambiguous,resolvedSubset:resolved.toString(),interpretation:'191/379 is a majority only within the resolved subset; 191/512 is not a full-set forced majority.'}};
 if(process.argv.includes('--write-evidence'))fs.writeFileSync(path.join(__dirname,'../results/presentation-examples.json'),JSON.stringify(evidence,null,2)+'\n');
 console.log(JSON.stringify({ok:true,controlledCases:String(sweep.length),wideWitnesses:'3',oneMicrosecondEditRejectedByBoth:true,closedEndpointThresholds:true,retainedDenominatorUnchanged:true}));
}
if(require.main===module)main();
module.exports={input,certify};
