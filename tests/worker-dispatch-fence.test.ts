import {test,type TestContext} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync} from 'node:fs';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {openJobLedger} from '../server/jobLedger.ts';
import {runOneDurableJob} from '../server/durableWorker.ts';

const session='00000000-0000-0000-0000-000000000001';
const payload=JSON.stringify({idea:'Test',provider:'auto',consent:false,context:{kind:'catalog',phase:'draft'}});
function fixture(t:TestContext){
 const dir=mkdtempSync(join(tmpdir(),'forgia-worker-fence-')),path=join(dir,'jobs.sqlite');
 const ledger=openJobLedger(path),id=ledger.enqueue(session,'project:pfence',payload);
 t.after(()=>{ledger.close();rmSync(dir,{recursive:true,force:true});});
 return {ledger,id,path};
}
test('WF1 fresh dispatch guard stops a second effect on immediate revocation',async t=>{
 const {ledger,id,path}=fixture(t);let valid=true;const effects:string[]=[];
 const outcome=await runOneDurableJob(ledger,{worker:'w',authorize:async()=>valid,run:async(_input,_session,_signal,guard)=>{
  await guard?.();effects.push('first');valid=false;
  await guard?.();effects.push('second');return {private:true};
 }});
 assert.equal(outcome,'uncertain');assert.deepEqual(effects,['first']);
 const reopened=openJobLedger(path);try{
  assert.equal(reopened.read(id,session)?.result,null);
  assert.equal(reopened.enqueue(session,'project:pfence',payload),id);
  assert.equal(reopened.claim('new',Date.now()+180000,30000),null);
 }finally{reopened.close();}
});
test('WF2 expired SQLite fence cannot authorize an effect before the heartbeat timer',async t=>{
 const {ledger,id}=fixture(t);let time=100,effects=0;
 const outcome=await runOneDurableJob(ledger,{worker:'w',now:()=>time,authorize:async()=>true,run:async(_i,_s,_sig,guard)=>{
  time=30100;await guard?.();effects++;return {ok:true};
 }});
 assert.equal(outcome,'lease-lost');assert.equal(effects,0);
 assert.equal(ledger.recoverExpired(time).uncertain,1);assert.equal(ledger.read(id,session)?.result,null);
});
test('WF3 valid fresh grant permits two effects and normal publication',async t=>{
 const {ledger,id}=fixture(t);let checks=0,effects=0;
 const outcome=await runOneDurableJob(ledger,{worker:'w',authorize:async()=>{checks++;return true;},run:async(_i,_s,_sig,guard)=>{
  await guard?.();effects++;await guard?.();effects++;return {ok:true};
 }});
 assert.equal(outcome,'done');assert.equal(effects,2);assert.ok(checks>=4);
 assert.deepEqual(JSON.parse(ledger.read(id,session)!.result!),{ok:true});
});
test('WF4 unavailable authorization denies dispatch and never stores details',async t=>{
 const {ledger,id}=fixture(t);let first=true,effects=0;
 const outcome=await runOneDurableJob(ledger,{worker:'w',authorize:async()=>{if(first){first=false;return true;}throw Error('synthetic private diagnostic');},run:async(_i,_s,_sig,guard)=>{
  await guard?.();effects++;return {ok:true};
 }});
 assert.equal(outcome,'uncertain');assert.equal(effects,0);assert.equal(ledger.read(id,session)?.result,null);
});
