import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {setTimeout as sleep} from 'node:timers/promises';
import {createJobs} from './server/jobs.ts';
import {pilotIdentity} from './server/pilot.ts';
import {diskStorage} from './server/disk.ts';
const id='aaaaaaaa-aaaa-4aaa-aaaa-aaaaaaaaaaaa',other='bbbbbbbb-bbbb-4bbb-bbbb-bbbbbbbbbbbb';
const token='a'.repeat(64),auth='Bearer '+token; // synthetic only
const now=Date.parse('2026-01-01T00:00:00Z');
const account={id,sha256:createHash('sha256').update(token).digest('hex'),expiresAt:new Date(now+1000).toISOString()};
const input={idea:'Synthetic task',provider:'local',cloudConsent:false};
async function terminal(q,job){for(let i=0;i<300;i++){const r=await q.read(job);if(['done','failed'].includes(r?.status))return r;await sleep(10);}throw Error('Timeout');}
for(const scenario of ['active','revoked','expired'])test('queued '+scenario,async()=>{
 const dir=await mkdtemp(join(tmpdir(),'forgia13-'));let release,entered;const gate=new Promise(r=>release=r),started=new Promise(r=>entered=r);let accounts=[account],clock=now,calls=0;
 try{
  const q=createJobs(diskStorage(dir),async(_input,_backlog,session)=>{if(session===other){entered();await gate;}else calls++;return {synthetic:true};});
  const first=await q.submit({...input,session:other});await started;
  assert.equal(pilotIdentity(auth,accounts,clock),id);
  const next=await q.submit({...input,session:id});assert.equal((await q.read(next.id)).status,'queued');
  if(scenario==='revoked')accounts=[];if(scenario==='expired')clock=now+1001;
  assert.equal(pilotIdentity(auth,accounts,clock),scenario==='active'?id:undefined);
  release();await terminal(q,first.id);const outcome=await terminal(q,next.id);
  console.log(JSON.stringify({scenario,authorizedAtDispatch:!!pilotIdentity(auth,accounts,clock),calls,outcome:outcome.status}));
  assert.equal(calls,scenario==='active'?1:0);
 }finally{release();await rm(dir,{recursive:true,force:true});}
});
test('persisted queued task with revoked identity at startup',async()=>{
 const dir=await mkdtemp(join(tmpdir(),'forgia13-'));try{
  const store=diskStorage(dir);const job='cccccccc-cccc-4ccc-cccc-cccccccccccc';
  assert.equal(pilotIdentity(auth,[],now),undefined);
  await store.setItem('jobs.v1',JSON.stringify([{id:job,session:id,status:'queued',input:{idea:input.idea,provider:input.provider,consent:false,context:{}}}]));
  let calls=0;const q=createJobs(diskStorage(dir),async()=>{calls++;return {synthetic:true};});
  const outcome=await terminal(q,job);console.log(JSON.stringify({scenario:'startup-revoked',calls,outcome:outcome.status}));assert.equal(calls,0);
 }finally{await rm(dir,{recursive:true,force:true});}
});
