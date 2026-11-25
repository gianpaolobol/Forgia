import {test,type TestContext} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createGateway} from '../server/gateway.ts';
import {openQuotaLedger} from '../server/quotaLedger.ts';
import {openCloudCache,cloudCacheKey} from '../server/cloudCache.ts';
import {ProviderError,type Provider} from '../server/providers.ts';

const spec={name:'Test',idea:'Catalogo',kind:'catalog',quiz:false,items:[{name:'Alba',category:'A',color:''}]};
const day=()=>new Date().toISOString().slice(0,10);
const storage=()=>{const data=new Map<string,string>();return {async getItem(k:string){return data.get(k)??null;},async setItem(k:string,v:string){data.set(k,v);}};};
const cloud=(overrides:Partial<Provider>={}):Provider=>({id:'groq',model:'test',mode:'free',async eligible(){return true;},async complete(){return JSON.stringify(spec);},...overrides});
const status=(code:number)=>(e:unknown)=>e instanceof ProviderError&&e.status===code;
function fixture(t:TestContext,counts:Record<string,number>={}) {
 const dir=mkdtempSync(join(tmpdir(),'forgia-gw-q-')),path=join(dir,'quota.db');
 const a=openQuotaLedger(path);a.initialize({version:1,day:day(),counts});
 const b=openQuotaLedger(path);
 t.after(()=>{a.close();b.close();rmSync(dir,{recursive:true,force:true});});
 return {a,b,path};
}

test('G1 concurrent gateway instances cannot exceed shared quota',async t=>{
 const {a,b}=fixture(t);let calls=0;
 let release!:()=>void;const barrier=new Promise<void>(r=>{release=r;});let checks=0;
 const provider=cloud({async eligible(){if(++checks===2)release();await barrier;return true;},async complete(){calls++;return JSON.stringify(spec);}});
 const x=createGateway(storage(),{quotaLedger:a,dailyLimit:1}),y=createGateway(storage(),{quotaLedger:b,dailyLimit:1});
 const settled=await Promise.allSettled([x.plan('A',provider,true),y.plan('B',provider,true)]);
 assert.equal(settled.filter(r=>r.status==='fulfilled').length,1);
 const failure=settled.find(r=>r.status==='rejected');assert.ok(failure&&status(429)(failure.reason));
 assert.equal(calls,1);assert.equal(b.read('groq').used,1);
});

test('G2 no consent or no eligibility consumes no quota',async t=>{
 const {a}=fixture(t);let checks=0,calls=0;
 const g=createGateway(storage(),{quotaLedger:a}),p=cloud({async eligible(){checks++;return false;},async complete(){calls++;return '';}});
 await assert.rejects(g.plan('A',p,false),/consenso/);assert.equal(checks,0);
 await assert.rejects(g.plan('A',p,true),status(403));assert.equal(checks,1);
 assert.equal(calls,0);assert.equal(a.read('groq').used,0);
});

test('G3 remote 429 persists cooldown across independent reopened connection',async t=>{
 const {a,path}=fixture(t);let calls=0;
 const p=cloud({async complete(){calls++;throw new ProviderError('limit',429);}});
 await assert.rejects(createGateway(storage(),{quotaLedger:a}).plan('A',p,true),status(429));
 const reopened=openQuotaLedger(path);try{
  assert.ok(reopened.read('groq').cooldownUntil>Date.now());
  await assert.rejects(createGateway(storage(),{quotaLedger:reopened}).plan('B',p,true),status(429));
  assert.equal(calls,1);assert.equal(reopened.read('groq').used,1);
 }finally{reopened.close();}
});

test('G4 automatic reserve is rechecked after competing manual grant',async t=>{
 const {a,b}=fixture(t,{groq:15});let calls=0;
 const p=cloud({async eligible(){assert.equal(b.reserve('groq').granted,true);return true;},async complete(){calls++;return JSON.stringify(spec);}});
 const g=createGateway(storage(),{quotaLedger:a});
 await assert.rejects(g.planAuto('A',[p],true,{kind:'catalog',phase:'draft'},0),status(429));
 assert.equal(calls,0);assert.equal(a.read('groq').used,16);
});

test('G5 opt-in bypasses legacy cloud cache and does not write JSON',async t=>{
 const {a}=fixture(t);const store=storage();let calls=0;
 const p=cloud({async complete(){calls++;return JSON.stringify(spec);}});
 const legacy=createGateway(store);await legacy.plan('A',p,true);const before=await store.getItem('gateway.v1');
 assert.equal((await legacy.plan('A',p,true)).cached,true);assert.equal(calls,1);
 const g=createGateway(store,{quotaLedger:a});assert.equal((await g.plan('A',p,true)).cached,false);
 assert.equal(calls,2);assert.equal(a.read('groq').used,1);assert.equal(await store.getItem('gateway.v1'),before);
});

test('G6 uninitialized ledger fails closed before provider checks',async t=>{
 const {path}=fixture(t);const uninitialized=openQuotaLedger(path+'.new');let checks=0;
 try {
  const p=cloud({async eligible(){checks++;return true;}});
  await assert.rejects(createGateway(storage(),{quotaLedger:uninitialized}).plan('A',p,true),/Stato quota non valido/);
  assert.equal(checks,0);
 } finally {uninitialized.close();}
});

test('G7 local legacy cache unchanged under opt-in',async t=>{
 const {a}=fixture(t);let calls=0;
 const p=cloud({id:'local',mode:'local',async complete(){calls++;return JSON.stringify(spec);}});
 const g=createGateway(storage(),{quotaLedger:a});assert.equal((await g.plan('A',p,false)).cached,false);
 assert.equal((await g.plan('A',p,false)).cached,true);assert.equal(calls,1);assert.equal(a.read('groq').used,0);
});

test('C4 shared cloud cache keeps consent, eligibility, scope and quota gates',async t=>{
 const {a,b,path}=fixture(t);const ca=openCloudCache(path),cb=openCloudCache(path);
 try {
  let calls=0,eligible=true;
  const p=cloud({async eligible(){return eligible;},async complete(){calls++;return JSON.stringify(spec);}});
  const x=createGateway(storage(),{quotaLedger:a,cloudCache:ca}),y=createGateway(storage(),{quotaLedger:b,cloudCache:cb});
  assert.equal((await x.plan('A',p,true,'session-a')).cached,false);
  assert.equal((await y.plan('A',p,true,'session-a')).cached,true);
  assert.equal(a.read('groq').used,1);assert.equal(calls,1);
  await assert.rejects(y.plan('A',p,false,'session-a'),/consenso/);
  eligible=false;await assert.rejects(y.plan('A',p,true,'session-a'),status(403));eligible=true;
  assert.equal((await y.plan('A',p,true,'session-b')).cached,false);
  assert.equal((await y.plan('A',{...p,model:'other'},true,'session-a')).cached,false);
  assert.equal(a.read('groq').used,3);assert.equal(calls,3);
  ca.write(cloudCacheKey('groq',p.model,'invalid','session-a'),{bad:true});
  await assert.rejects(x.plan('invalid',p,true,'session-a'));assert.equal(calls,3);
  assert.throws(()=>createGateway(storage(),{cloudCache:ca}),/registro quote/);
 }finally{ca.close();cb.close();}
});

test('P4 catalog preflight 429 persists across gateways without inference reservation',async t=>{
 const {a,b,path}=fixture(t);let checks=0,calls=0;
 const {QuotaDeferral}=await import('../server/quotaDeferral.ts');
 const until=Date.now()+180000;
 const p=cloud({id:'openrouter',async eligible(){checks++;throw new QuotaDeferral(until);},async complete(){calls++;return JSON.stringify(spec);}});
 await assert.rejects(createGateway(storage(),{quotaLedger:a}).plan('A',p,true),e=>e instanceof QuotaDeferral&&e.nextEligibleAt===until);
 assert.equal(b.read('openrouter').used,0);
 assert.ok(b.read('openrouter').cooldownUntil>=until);
 const reopened=openQuotaLedger(path);
 try {
  await assert.rejects(createGateway(storage(),{quotaLedger:reopened}).plan('B',p,true),status(429));
  assert.equal(checks,1);assert.equal(calls,0);assert.equal(reopened.read('openrouter').used,0);
 }finally{reopened.close();}
});
