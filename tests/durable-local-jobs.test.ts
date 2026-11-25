import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {prepareLocalLedger,createDurableLocalJobs} from '../server/durableJobs.ts';
const session='00000000-0000-0000-0000-000000000001';
const other='00000000-0000-0000-0000-000000000002';
const body={session,idea:'Un catalogo',provider:'local',cloudConsent:true};
const wait=async (jobs:ReturnType<typeof createDurableLocalJobs>,id:string)=>{
 for(let i=0;i<100;i++){
  const row=await jobs.read(id,session);
  if(row?.status==='done'||row?.status==='failed')return row;
  await new Promise(r=>setTimeout(r,25));
 }
 throw Error('Timeout test');
};
test('D1 cutover esplicito, API, idempotenza, isolamento e riapertura reale',async()=>{
 const dir=mkdtempSync(join(tmpdir(),'forgia-local-'));
 let ledger:ReturnType<typeof prepareLocalLedger>|undefined;
 let jobs:ReturnType<typeof createDurableLocalJobs>|undefined;
 try{
  assert.throws(()=>prepareLocalLedger(dir,'[]',false));
  ledger=prepareLocalLedger(dir,'[]',true);
  let calls=0;
  jobs=createDurableLocalJobs(ledger,async(input)=>{calls++;assert.equal(input.consent,false);return {ok:true};});
  await assert.rejects(jobs.submit(body));
  jobs.start();
  await assert.rejects(jobs.submit({...body,provider:'groq'}));
  const {id}=await jobs.submit(body,'one');
  assert.equal((await jobs.submit(body,'one')).id,id);
  await assert.rejects(jobs.submit({...body,idea:'Diversa'},'one'));
  assert.equal(await jobs.read(id,other),null);
  assert.deepEqual(await wait(jobs,id),{status:'done',result:{ok:true}});
  assert.equal(calls,1);
  await jobs.stop();ledger.close();ledger=undefined;
  assert.throws(()=>prepareLocalLedger(dir,'[]',true));
  assert.throws(()=>prepareLocalLedger(dir,'[{}]',false));
  ledger=prepareLocalLedger(dir,'[]',false);
  jobs=createDurableLocalJobs(ledger,async()=>{throw Error('Non deve ripetere');});
  assert.deepEqual(await jobs.read(id),{status:'done',result:{ok:true}});
 }finally{await jobs?.stop();ledger?.close();rmSync(dir,{recursive:true,force:true});}
});
test('D2 migrazione offline: running incerto, queued cloud rifiutato, queued locale eseguito',async()=>{
 const dir=mkdtempSync(join(tmpdir(),'forgia-local-'));
 const ids=['10000000-0000-0000-0000-000000000001','10000000-0000-0000-0000-000000000002','10000000-0000-0000-0000-000000000003'];
 const snapshot=JSON.stringify(ids.map((id,i)=>({id,session,status:i===0?'running':'queued',input:{idea:'Catalogo',provider:i===1?'groq':'auto',consent:true,context:{kind:'catalog',phase:'draft'}}})));
 const ledger=prepareLocalLedger(dir,snapshot,true);
 let calls=0;
 const jobs=createDurableLocalJobs(ledger,async(input)=>{calls++;assert.equal(input.consent,false);return {ok:true};});
 try{
  jobs.start();
  assert.equal((await wait(jobs,ids[0]))?.status,'failed');
  assert.equal((await wait(jobs,ids[1]))?.status,'failed');
  assert.equal((await wait(jobs,ids[2]))?.status,'done');
  assert.equal(calls,1);
 }finally{await jobs.stop();ledger.close();rmSync(dir,{recursive:true,force:true});}
});
