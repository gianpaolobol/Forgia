import {test,type TestContext} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,writeFileSync,readFileSync,existsSync,rmSync,chmodSync,symlinkSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {prepareCloudState} from '../server/cloudState.ts';
import {cloudCacheKey} from '../server/cloudCache.ts';
function fixture(t:TestContext) {
 const dir=mkdtempSync(join(tmpdir(),'forgia-state-'));
 const jobs=join(dir,'jobs.sqlite'),db=join(dir,'cloud.sqlite');
 writeFileSync(jobs,'fixture',{mode:0o600});
 t.after(()=>rmSync(dir,{recursive:true,force:true}));
 return {dir,jobs,db};
}
const snapshot=()=>JSON.stringify({version:1,day:new Date().toISOString().slice(0,10),counts:{groq:19,openrouter:2,local:8},cache:{}});
test('B1 bootstrap preserves counters and cache across restart',t=>{
 const {dir,jobs}=fixture(t),key=cloudCacheKey('groq','model','prompt','session');
 const raw=snapshot(),state=prepareCloudState(dir,true,raw);
 try {
  assert.equal(state.quotaLedger.read('groq').used,19);
  assert.equal(state.quotaLedger.reserve('groq').granted,true);
  assert.equal(state.quotaLedger.reserve('groq').granted,false);
  assert.equal(state.quotaLedger.read('openrouter').used,2);
  state.cloudCache.write(key,{sample:true});
 }finally{state.close();}
 const reopened=prepareCloudState(dir,false,null);
 try {
  assert.equal(reopened.quotaLedger.read('groq').used,20);
  assert.equal(reopened.quotaLedger.reserve('groq').granted,false);
  assert.deepEqual(reopened.cloudCache.read(key),{sample:true});
  assert.equal(readFileSync(jobs,'utf8'),'fixture');
 }finally{reopened.close();}
 assert.throws(()=>prepareCloudState(dir,true,raw),{code:'EEXIST'});
});
test('B2 missing or corrupt source cannot silently initialize quota',t=>{
 const {dir,db}=fixture(t);
 for(const raw of [null,'null','{broken']) {
  assert.throws(()=>prepareCloudState(dir,true,raw));assert.equal(existsSync(db),false);
 }
 assert.throws(()=>prepareCloudState(dir,true,'{}'),/Stato quota/);
 assert.equal(existsSync(db),true);
 assert.throws(()=>prepareCloudState(dir,false,null),/Stato quota/);
 assert.throws(()=>prepareCloudState(dir,true,snapshot()),{code:'EEXIST'});
});
test('B3 missing database or missing local cutover is not repaired automatically',t=>{
 const {dir,jobs,db}=fixture(t);
 assert.throws(()=>prepareCloudState(dir,false,null),{code:'ENOENT'});
 assert.equal(existsSync(db),false);
 rmSync(jobs);
 assert.throws(()=>prepareCloudState(dir,true,snapshot()),{code:'ENOENT'});
 assert.equal(existsSync(db),false);
});
test('B4 insecure file permissions and symlink sidecars are rejected',{skip:process.platform==='win32'},t=>{
 const {dir,db}=fixture(t);
 chmodSync(dir,0o755);
 assert.throws(()=>prepareCloudState(dir,true,snapshot()),/non privato/);
 chmodSync(dir,0o700);
 symlinkSync(join(dir,'jobs.sqlite'),db+'-wal');
 assert.throws(()=>prepareCloudState(dir,true,snapshot()),/non privato/);
 rmSync(db+'-wal');
 const state=prepareCloudState(dir,true,snapshot());state.close();
 chmodSync(db,0o644);
 assert.throws(()=>prepareCloudState(dir,false,null),/non privato/);
});
