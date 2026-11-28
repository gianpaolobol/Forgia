import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {explicitCloudPolicy} from '../server/explicitCloudPolicy.ts';
import {prepareLocalLedger,createDurableLocalJobs} from '../server/durableJobs.ts';
import {prepareCloudState} from '../server/cloudState.ts';
import {createGateway} from '../server/gateway.ts';
import {createProvider} from '../server/providers.ts';
const session='00000000-0000-0000-0000-000000000001',other='00000000-0000-0000-0000-000000000002',grant='a'.repeat(64),model='fixture/model:free';
const policy=explicitCloudPolicy(session,{protectedLedger:true,model,hasKey:true})!;
const keys={first:'cloud:pfirst',second:'cloud:psecond',bad:'cloud:pbad',noGrant:'cloud:pnogrant',revoked:'cloud:prevoked',disabled:'cloud:pdisabled'};
const body={session,idea:'Catalogo sintetico',provider:'openrouter',cloudConsent:true,expectedModel:model};
const spec={name:'Test',idea:'Catalogo',kind:'catalog',quiz:false,items:[{name:'Alba',category:'A',color:''}]};
const wait=async(jobs:ReturnType<typeof createDurableLocalJobs>,id:string)=>{
 for(let i=0;i<160;i++){const row=await jobs.read(id,session,grant);if(row?.status==='done'||row?.status==='failed')return row;await new Promise(r=>setTimeout(r,25));}
 throw Error('Timeout test');
};
test('EC1 opt-in single protected session, explicit :free model and key required',()=>{
 const state={protectedLedger:true,model,hasKey:true};
 assert.equal(explicitCloudPolicy(undefined,state),undefined);
 assert.deepEqual(explicitCloudPolicy(session,state),policy);
 for(const bad of [{...state,protectedLedger:false},{...state,hasKey:false},{...state,model:'fixture/model'},{...state,model:'https://example.invalid:free'}])assert.throws(()=>explicitCloudPolicy(session,bad));
 assert.throws(()=>explicitCloudPolicy('',state));
});
test('EC2 protected queue to real adapter and SQLite quota/cache across reopen; synthetic transport only',async()=>{
 const dir=mkdtempSync(join(tmpdir(),'forgia-explicit-cloud-'));
 let ledger=prepareLocalLedger(dir,'[]',true);
 let state=prepareCloudState(dir,true,JSON.stringify({version:1,day:new Date().toISOString().slice(0,10),counts:{openrouter:2}}));
 let jobs:ReturnType<typeof createDurableLocalJobs>|undefined;
 let calls=0,checks=0,allowed=true;
 const provider=createProvider({id:'openrouter',model,apiKey:'synthetic'},async(url,options)=>{
  if(url.endsWith('/models')){checks++;return Response.json({data:[{id:model,pricing:{prompt:'0',completion:'0'}}]});}
  assert.equal(url,'https://openrouter.ai/api/v1/chat/completions');
  const data=JSON.parse(String(options?.body));assert.equal(data.model,model);assert.equal(data.provider.allow_fallbacks,false);assert.deepEqual(data.provider.max_price,{prompt:0,completion:0,request:0});
  calls++;return Response.json({choices:[{message:{content:JSON.stringify(spec)},finish_reason:'stop'}]});
 });
 const store={async getItem(_k:string){return null;},async setItem(_k:string,_v:string){throw Error('Legacy quota write');}};
 const start=(enabled:boolean)=>{
  const gateway=createGateway(store,state);
  const q=createDurableLocalJobs(ledger,async(input,_backlog,s,signal)=>{
   assert.equal(input.provider,'openrouter');assert.equal(input.expectedModel,model);assert.equal(input.consent,true);
   return gateway.plan(input.idea,provider,input.consent,s+':'+input.authorizationGrant,signal);
  },id=>id==='openrouter'?model:undefined,async(s,g)=>allowed&&[session,other].includes(s)&&g===grant,enabled?policy:undefined);
  q.start();return q;
 };
 try{
  assert.throws(()=>createDurableLocalJobs(ledger,async()=>({}),undefined,undefined,policy));
  jobs=start(true);
  await assert.rejects(jobs.submit(body,keys.noGrant));
  for(const bad of [{...body,session:other},{...body,cloudConsent:false},{...body,expectedModel:undefined},{...body,expectedModel:'other/model:free'},{...body,provider:'groq'}])await assert.rejects(jobs.submit(bad,keys.bad,grant));
  assert.equal(checks,0);assert.equal(calls,0);
  const first=await jobs.submit(body,keys.first,grant);
  assert.equal((await jobs.submit(body,keys.first,grant)).id,first.id);
  const result=await wait(jobs,first.id);assert.equal(result?.status,'done');
  assert.equal((result as {result?:{cached:boolean}}).result?.cached,false);
  assert.equal(state.quotaLedger.read('openrouter').used,3);assert.equal(calls,1);
  await jobs.stop();ledger.close();state.close();
  ledger=prepareLocalLedger(dir,'[]',false);state=prepareCloudState(dir,false,null);jobs=start(true);
  assert.deepEqual(await jobs.read(first.id,session,grant),result);assert.deepEqual(await jobs.findReceipt(session,keys.first,grant),first);
  assert.equal(await jobs.findReceipt(session,keys.first,'b'.repeat(64)),null);
  assert.equal(await jobs.findReceipt(other,keys.first,grant),null);
  await assert.rejects(jobs.findReceipt(session,'first',grant),{status:400});
  const second=await jobs.submit(body,keys.second,grant),cached=await wait(jobs,second.id);
  assert.equal((cached as {result?:{cached:boolean}}).result?.cached,true);
  assert.equal(calls,1);assert.equal(checks,2);assert.equal(state.quotaLedger.read('openrouter').used,3);
  allowed=false;assert.equal(await jobs.read(first.id,session,grant),null);assert.equal(await jobs.findReceipt(session,keys.first,grant),null);await assert.rejects(jobs.submit(body,keys.revoked,grant));
  await jobs.stop();allowed=true;jobs=start(false);await assert.rejects(jobs.submit(body,keys.disabled,grant));
  assert.equal(calls,1);
 }finally{await jobs?.stop();ledger.close();state.close();rmSync(dir,{recursive:true,force:true});}
});
