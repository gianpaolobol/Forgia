import test from 'node:test';
import assert from 'node:assert/strict';
import {createJobs} from '../server/jobs.ts';
const session='11111111-1111-4111-8111-111111111111';
const oldGrant='a'.repeat(64), newGrant='b'.repeat(64);
const body={session,idea:'Catalogo di prova',provider:'auto'};
function memory(initial?:string){
 const data=new Map<string,string>();if(initial)data.set('jobs.v1',initial);
 return {async getItem(k:string){return data.get(k)??null;},async setItem(k:string,v:string){data.set(k,v);}};
}
const delay=(ms:number)=>new Promise(resolve=>setTimeout(resolve,ms));
async function until<T>(fn:()=>Promise<T>,predicate:(value:T)=>boolean){
 for(let i=0;i<200;i++){const value=await fn();if(predicate(value))return value;await delay(10);}
 throw Error('Timeout test');
}
test('A7a: queue rechecks grant, revokes running and queued jobs, separates rotation', {timeout:5000},async()=>{
 const store=memory();let valid=oldGrant,calls=0;let release!:()=>void;
 const held=new Promise<void>(resolve=>{release=resolve;});
 const jobs=createJobs(store,async(_input,_backlog,_session,signal)=>{
  calls++;
  if(calls===1)await held;
  signal?.throwIfAborted();return 'fixture';
 },async(s,g)=>s===session&&g===valid);
 try {
  const first=await jobs.submit(body,'project:p1',oldGrant);
  await until(async()=>calls,n=>n===1);
  const queued=await jobs.submit({...body,idea:'Altro catalogo'},'project:p2',oldGrant);
  valid=newGrant;
  const failed=await until(()=>jobs.read(first.id,session,oldGrant),j=>j?.status==='failed');
  assert.equal(failed?.status,'failed');
  const second=await until(()=>jobs.read(queued.id,session,oldGrant),j=>j?.status==='failed');
  assert.equal(second?.status,'failed');assert.equal(calls,1);
  assert.equal(await jobs.read(first.id,session,newGrant),null);
  const replacement=await jobs.submit(body,'project:p1',newGrant);
  assert.notEqual(replacement.id,first.id);
  assert.equal((await until(()=>jobs.read(replacement.id,session,newGrant),j=>j?.status==='done'))?.status,'done');
  assert.equal(await jobs.read(replacement.id,session,oldGrant),null);assert.equal(calls,2);
 } finally {release();}
});
test('A7b: pre-upgrade pilot job without grant is not dispatched, local queue unchanged',{timeout:4000},async()=>{
 const id='22222222-2222-4222-8222-222222222222';
 const input={idea:body.idea,provider:'auto',consent:false,context:{kind:'catalog',phase:'draft'}};
 const store=memory(JSON.stringify([{id,session,status:'queued',input}]));let calls=0;
 const pilot=createJobs(store,async()=>++calls,async()=>true);
 await until(()=>store.getItem('jobs.v1'),v=>!!v&&JSON.parse(v)[0].status==='failed');
 assert.equal(calls,0);assert.equal(await pilot.read(id,session,newGrant),null);
 const local=createJobs(memory(),async()=>++calls);
 const receipt=await local.submit(body,'project:p1');
 assert.equal((await until(()=>local.read(receipt.id),j=>j?.status==='done'))?.status,'done');assert.equal(calls,1);
});
