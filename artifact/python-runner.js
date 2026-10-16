'use strict';
// Rebuilt portable interpreter discovery; never uses WindowsApps store aliases.
const fs=require('node:fs');
const path=require('node:path');
const {spawnSync}=require('node:child_process');
let cached;
function resolvePython() {
  if(cached) return cached;
  const candidates=[];
  if(process.env.RACECERT_PYTHON) candidates.push([process.env.RACECERT_PYTHON,[]]);
  candidates.push([path.join(__dirname,'runtime','win-x64','python','python.exe'),[]]);
  if(process.platform==='win32') candidates.push(['py',['-3']]);
  for(const name of ['python3','python']) {
    for(const dir of (process.env.PATH || '').split(path.delimiter)) {
      if(/WindowsApps/i.test(dir)) continue;
      const bin=path.join(dir,name+(process.platform==='win32'?'.exe':''));
      if(fs.existsSync(bin)) candidates.push([bin,[]]);
    }
  }
  for(const [command,args] of candidates) {
    if(/WindowsApps/i.test(command)) continue;
    const r=spawnSync(command,[...args,'-I','-B','-c',"import sys,json,hashlib; from fractions import Fraction; print('racecert-python:'+str(sys.version_info.major)+'.'+str(sys.version_info.minor))"],{encoding:'utf8',timeout:5000,windowsHide:true});
    if(r.status===0 && r.stdout.startsWith('racecert-python:3.')) {cached={command,args,runtime:r.stdout.trim().slice('racecert-python:'.length)};return cached;}
  }
  throw new Error('Python 3 unavailable: include runtime/win-x64/python or set RACECERT_PYTHON to a real interpreter (not WindowsApps).');
}
function probePythonVerifier() { try { const p=resolvePython(); return {ok:true,runtime:'Python '+p.runtime,command:p.command}; } catch(e) {return {ok:false,reason:e.message};} }
function runPythonVerifier(document) {
  try {
    const p=resolvePython(),r=spawnSync(p.command,[...p.args,'-I','-B',path.join(__dirname,'verifier_py.py')],{input:JSON.stringify(document),encoding:'utf8',timeout:60000,maxBuffer:16*1024*1024,windowsHide:true});
    if(r.error) throw r.error;
    const result=JSON.parse(r.stdout); if(r.status!==0 && result.ok) throw new Error('Python process failed while reporting success');
    return {...result,runtime:'Python '+p.runtime};
  } catch(e) { return {ok:false,reason:e.message,runtime:'unavailable'}; }
}
module.exports={runPythonVerifier,probePythonVerifier};
