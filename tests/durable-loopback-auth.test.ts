import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {mkdtempSync,rmSync,writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {prepareLocalLedger,createDurableLocalJobs} from '../server/durableJobs.ts';
import {prepareDurableLocalAuth} from '../server/durableLocalAuth.ts';
const session='00000000-0000-0000-0000-000000000001',other='00000000-0000-0000-0000-000000000002';
const token='a'.repeat(64),rotated='b'.repeat(64);
const account=(id:string,value:string)=>({id,sha256:createHash('sha256').update(value).digest('hex'),expiresAt:new Date(Date.now()+600000).toISOString()});
const delay=(ms:number)=>new Promise(r=>setTimeout(r,ms));
test('A1 explicit local policy, persisted grant, scoped read and receipt, rotation and restart',async()=>{
 const dir=mkdtempSync(join(tmpdir(),'forgia-auth-'));
 let ledger=prepareLocalLedger(dir,'[]',true);
 let jobs:ReturnType<typeof createDurableLocalJobs>|undefined;
 try{
  const path=join(dir,'accounts.json'),a=account(session,token),b=account(other,rotated);
  writeFileSync(path,JSON.stringify([a,b]),{mode:0o600});
  assert.throws(()=>prepareDurableLocalAuth(dir,false));
  const auth=prepareDurableLocalAuth(dir,true)!;
  const identity=auth.identity('Bearer '+token)!,foreign=auth.identity('Bearer '+rotated)!;
  assert.equal(identity.session,session);assert.equal(auth.identity('Bearer '+'c'.repeat(64)),undefined);
  let calls=0;
  jobs=createDurableLocalJobs(ledger,async()=>{calls++;return {ok:true};},undefined,auth.active);
  jobs.start();
  const body={session,provider:'local',idea:'Catalogo'};
  await assert.rejects(jobs.submit(body,'p1:p2'));
  await assert.rejects(jobs.submit({...body,session:other},'p1:p2',identity.grant));
  const {id}=await jobs.submit(body,'p1:p2',identity.grant);
  assert.equal((await jobs.submit(body,'p1:p2',identity.grant)).id,id);
  for(let i=0;i<100;i++){if((await jobs.read(id,session,identity.grant))?.status==='done')break;await delay(25);}
  assert.deepEqual(await jobs.read(id,session,identity.grant),{status:'done',result:{ok:true}});
  assert.equal(await jobs.read(id),null);assert.equal(await jobs.read(id,other,foreign.grant),null);
  assert.deepEqual(await jobs.findReceipt(session,'p1:p2',identity.grant),{id});
  assert.equal(await jobs.findReceipt(session,'p1:p2',foreign.grant),null);
  assert.equal(calls,1);assert.ok(!ledger.readLocal(id)!.payload.includes(token));
  await jobs.stop();ledger.close();
  ledger=prepareLocalLedger(dir,'[]',false);
  jobs=createDurableLocalJobs(ledger,async()=>{throw Error('Unexpected replay');},undefined,auth.active);
  assert.deepEqual(await jobs.read(id,session,identity.grant),{status:'done',result:{ok:true}});
  writeFileSync(path,JSON.stringify([account(session,rotated)]));
  const newGrant=auth.identity('Bearer '+rotated)!.grant;
  assert.equal(await jobs.read(id,session,identity.grant),null);
  assert.equal(await jobs.read(id,session,newGrant),null);
  assert.equal(await jobs.findReceipt(session,'p1:p2',newGrant),null);
  rmSync(path);assert.throws(()=>prepareDurableLocalAuth(dir,false));assert.throws(()=>prepareDurableLocalAuth(dir,true));
 }finally{await jobs?.stop();ledger.close();rmSync(dir,{recursive:true,force:true});}
});
test('A2 worker aborts after persisted policy revocation; no result or replay in trusted fallback',async()=>{
 const dir=mkdtempSync(join(tmpdir(),'forgia-auth-'));
 const ledger=prepareLocalLedger(dir,'[]',true);
 let jobs:ReturnType<typeof createDurableLocalJobs>|undefined;
 try{
  const path=join(dir,'accounts.json');writeFileSync(path,JSON.stringify([account(session,token)]),{mode:0o600});
  const auth=prepareDurableLocalAuth(dir,true)!,grant=auth.identity('Bearer '+token)!.grant;
  let calls=0,started=false,aborted=false;
  jobs=createDurableLocalJobs(ledger,async(_input,_backlog,_session,signal)=>{
   calls++;started=true;return new Promise((_,reject)=>signal.addEventListener('abort',()=>{aborted=true;reject(Error('aborted'));},{once:true}));
  },undefined,auth.active);
  jobs.start();
  const {id}=await jobs.submit({session,provider:'local',idea:'Catalogo'},'p1:p2',grant);
  for(let i=0;i<100&&!started;i++)await delay(25);
  assert.equal(started,true);writeFileSync(path,'[]');
  for(let i=0;i<100&&ledger.readLocal(id)?.status!=='uncertain';i++)await delay(25);
  assert.equal(aborted,true);assert.equal(ledger.readLocal(id)?.status,'uncertain');assert.equal(calls,1);
  assert.equal(await jobs.read(id,session,grant),null);
  await jobs.stop();
  jobs=createDurableLocalJobs(ledger,async()=>{calls++;return {};});
  assert.equal(await jobs.read(id),null);
  assert.equal(await jobs.findReceipt(session,'p1:p2'),null);
  jobs.start();await delay(600);assert.equal(calls,1);
 }finally{await jobs?.stop();ledger.close();rmSync(dir,{recursive:true,force:true});}
});
