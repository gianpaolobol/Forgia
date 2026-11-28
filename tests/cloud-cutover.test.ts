import {test,type TestContext} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,writeFileSync,existsSync,renameSync,rmSync,chmodSync,symlinkSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {prepareCloudState,assertCloudStateMode} from '../server/cloudState.ts';
import {openQuotaLedger} from '../server/quotaLedger.ts';
import {cloudCacheKey} from '../server/cloudCache.ts';
function fixture(t:TestContext) {
 const dir=mkdtempSync(join(tmpdir(),'forgia-cutover-'));
 const jobs=join(dir,'jobs.sqlite'),db=join(dir,'cloud.sqlite'),marker=join(dir,'cloud-required');
 writeFileSync(jobs,'fixture',{mode:0o600});
 t.after(()=>rmSync(dir,{recursive:true,force:true}));
 return {dir,db,marker};
}
const snapshot=()=>JSON.stringify({version:1,day:new Date().toISOString().slice(0,10),counts:{openrouter:2},cache:{}});
test('B5 loss of cloud database cannot authorize quota reset or downgrade; restore preserves quota and cache',t=>{
 const {dir,db}=fixture(t),raw=snapshot(),key=cloudCacheKey('openrouter','fixture:free','prompt','session');
 const state=prepareCloudState(dir,true,raw);
 try{assert.equal(state.quotaLedger.reserve('openrouter').used,3);state.cloudCache.write(key,{sample:true});}finally{state.close();}
 renameSync(db,db+'.backup');
 assert.throws(()=>assertCloudStateMode(dir,false),/quota\/cache/);
 assert.throws(()=>prepareCloudState(dir,false,null));
 assert.throws(()=>{const fresh=prepareCloudState(dir,true,raw);fresh.close();},/quota\/cache/);
 assert.equal(existsSync(db),false);
 renameSync(db+'.backup',db);
 const restored=prepareCloudState(dir,false,null);
 try{assert.equal(restored.quotaLedger.read('openrouter').used,3);assert.deepEqual(restored.cloudCache.read(key),{sample:true});}finally{restored.close();}
});
test('B6 valid pre-marker cloud database is adopted without resetting counters',t=>{
 const {dir,db,marker}=fixture(t);writeFileSync(db,'',{mode:0o600});
 const old=openQuotaLedger(db);try{old.initialize(JSON.parse(snapshot()));assert.equal(old.reserve('openrouter').used,3);}finally{old.close();}
 assert.equal(existsSync(marker),false);
 const adopted=prepareCloudState(dir,false,null);try{assert.equal(adopted.quotaLedger.read('openrouter').used,3);}finally{adopted.close();}
 assert.equal(existsSync(marker),true);
 assert.throws(()=>assertCloudStateMode(dir,false),/quota\/cache/);
});
test('B7 orphan sidecar blocks downgrade and reinitialization without overwriting the evidence',t=>{
 const {dir,db}=fixture(t),wal=db+'-wal';writeFileSync(wal,'fixture orphan WAL',{mode:0o600});
 assert.throws(()=>assertCloudStateMode(dir,false),/quota\/cache/);
 assert.throws(()=>{const state=prepareCloudState(dir,true,snapshot());state.close();},/quota\/cache/);
 assert.equal(existsSync(wal),true);assert.equal(existsSync(db),false);
});
test('B8 insecure or dangling cutover marker is rejected',{skip:process.platform==='win32'},t=>{
 const {dir,db,marker}=fixture(t);symlinkSync(db,marker);
 assert.throws(()=>assertCloudStateMode(dir,false),/quota\/cache/);
 assert.throws(()=>{const state=prepareCloudState(dir,true,snapshot());state.close();},/quota\/cache/);
 rmSync(marker);writeFileSync(marker,'',{mode:0o600});chmodSync(marker,0o644);
 assert.throws(()=>assertCloudStateMode(dir,false),/quota\/cache/);
 assert.throws(()=>prepareCloudState(dir,true,snapshot()),/quota\/cache/);
});
