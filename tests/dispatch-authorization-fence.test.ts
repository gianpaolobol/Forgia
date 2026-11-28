import {test,type TestContext} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync} from 'node:fs';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {openJobLedger} from '../server/jobLedger.ts';
import {runOneDurableJob} from '../server/durableWorker.ts';
import {createGateway} from '../server/gateway.ts';
import {createProvider,type Provider} from '../server/providers.ts';
import {openQuotaLedger} from '../server/quotaLedger.ts';
import {openCloudCache,cloudCacheKey} from '../server/cloudCache.ts';

const session='00000000-0000-0000-0000-000000000001';
const context={kind:'catalog',phase:'draft'} as const;
const idea='Catalogo di prova';
const spec={name:'Test',idea,kind:'catalog',quiz:false,items:[{name:'Alba',category:'A',color:''}]};
const payload=(provider='auto',extra:Record<string,unknown>={})=>JSON.stringify({idea,provider,consent:false,context,...extra});
function fixture(t:TestContext){
 const dir=mkdtempSync(join(tmpdir(),'forgia-dispatch-auth-'));
 const ledger=openJobLedger(join(dir,'jobs.sqlite'));
 const quotaLedger=openQuotaLedger(join(dir,'cloud.sqlite'));quotaLedger.initialize(null);
 const cloudCache=openCloudCache(join(dir,'cloud.sqlite'));
 t.after(()=>{ledger.close();quotaLedger.close();cloudCache.close();rmSync(dir,{recursive:true,force:true});});
 const data=new Map<string,string>();
 const store={async getItem(k:string){return data.get(k)??null;},async setItem(k:string,v:string){data.set(k,v);}};
 const gateway=createGateway(store,{quotaLedger,cloudCache,localCooldownLedger:ledger,conservativeAuto:true});
 return {ledger,quotaLedger,cloudCache,gateway};
}
function locals(first:()=>Promise<Response>,calls:string[]){
 const a=createProvider({id:'local',model:'fixture-local',fit:{catalog:10,draft:10}},async()=>{calls.push('local');return first();});
 const b=createProvider({id:'llamacpp',model:'fixture-alt',fit:{catalog:1,draft:1}},async()=>{calls.push('llamacpp');return Response.json({choices:[{message:{content:JSON.stringify(spec)}}]});});
 return [a,b];
}
test('DF1 revoke at explicit HTTP 429: no second inference before periodic poll',async t=>{
 const {ledger,gateway}=fixture(t),raw=payload(),id=ledger.enqueue(session,'df1',raw);
 let valid=true;const calls:string[]=[];
 const providers=locals(async()=>{valid=false;return new Response('',{status:429,headers:{'Retry-After':'120'}});},calls);
 const outcome=await runOneDurableJob(ledger,{worker:'w',authorize:async()=>valid,run:(input,s,signal,guard)=>gateway.planAuto(input.idea,providers,false,context,0,s,signal,guard)});
 assert.equal(outcome,'uncertain');assert.deepEqual(calls,['local']);
 assert.equal(ledger.read(id,session)?.result,null);assert.equal(ledger.enqueue(session,'df1',raw),id);
 assert.equal(ledger.claim('new',Date.now()+180000,30000),null);
});
test('DF2 revoke at cloud eligibility: no inference, no refund, no cache/result',async t=>{
 const {ledger,gateway,quotaLedger,cloudCache}=fixture(t);
 const model='fixture/model:free',grant='a'.repeat(64),scope=session+':'+grant;
 const id=ledger.enqueue(session,'df2',payload('openrouter',{consent:true,expectedModel:model,authorizationGrant:grant}));
 let valid=true,calls=0;
 const provider:Provider={id:'openrouter',mode:'free',model,async eligible(){valid=false;return true;},async complete(){calls++;return JSON.stringify(spec);}};
 const outcome=await runOneDurableJob(ledger,{worker:'w',authorize:async()=>valid,run:(input,_s,signal,guard)=>gateway.plan(input.idea,provider,true,scope,signal,guard)});
 assert.equal(outcome,'uncertain');assert.equal(calls,0);
 assert.equal(quotaLedger.read('openrouter').used,1);
 assert.equal(cloudCache.read(cloudCacheKey('openrouter',model,idea,scope)),undefined);
 assert.equal(ledger.read(id,session)?.result,null);
});
test('DF3 stale lease at provider boundary cannot send; recovery stays uncertain',async t=>{
 const {ledger,gateway}=fixture(t),id=ledger.enqueue(session,'df3',payload('local'));
 let time=100,calls=0;
 const provider:Provider={id:'local',mode:'local',model:'fixture-local',async eligible(){time=30100;return true;},async complete(){calls++;return JSON.stringify(spec);}};
 const outcome=await runOneDurableJob(ledger,{worker:'w',now:()=>time,authorize:async()=>true,run:(input,s,signal,guard)=>gateway.plan(input.idea,provider,false,s,signal,guard)});
 assert.equal(outcome,'lease-lost');assert.equal(calls,0);
 assert.equal(ledger.recoverExpired(time).uncertain,1);assert.equal(ledger.read(id,session)?.result,null);
});
test('DF4 valid grant and fence preserve authorized fallback and result',async t=>{
 const {ledger,gateway}=fixture(t),id=ledger.enqueue(session,'df4',payload());
 const calls:string[]=[];let checks=0;
 const providers=locals(async()=>new Response('',{status:429,headers:{'Retry-After':'120'}}),calls);
 const outcome=await runOneDurableJob(ledger,{worker:'w',authorize:async()=>{checks++;return true;},run:(input,s,signal,guard)=>gateway.planAuto(input.idea,providers,false,context,0,s,signal,guard)});
 assert.equal(outcome,'done');assert.deepEqual(calls,['local','llamacpp']);assert.ok(checks>=4);
 assert.equal(JSON.parse(ledger.read(id,session)!.result!).routing.provider,'llamacpp');
});
