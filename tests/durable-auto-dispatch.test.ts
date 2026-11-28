import test from 'node:test';
import assert from 'node:assert/strict';
import {createGateway} from '../server/gateway.ts';
import {createProvider,ProviderError,type Provider} from '../server/providers.ts';
import {QuotaDeferral} from '../server/quotaDeferral.ts';

const spec={name:'Catalogo',idea:'Catalogo di prova',kind:'catalog',quiz:false,items:[{name:'Libro',category:'Narrativa',color:''}]};
const context={kind:'catalog',phase:'draft'} as const;
class Memory {
 data=new Map<string,string>();
 async getItem(k:string){return this.data.get(k)??null;}
 async setItem(k:string,v:string){this.data.set(k,v);}
}
function fixture(first:()=>Promise<Response>,conservativeAuto=true){
 const calls:string[]=[];
 const a=createProvider({id:'local',model:'fixture-local',fit:{catalog:10,draft:10}},async()=>{calls.push('local');return first();});
 const b=createProvider({id:'llamacpp',model:'fixture-alt',fit:{catalog:1,draft:1}},async()=>{calls.push('llamacpp');return new Response(JSON.stringify({choices:[{message:{content:JSON.stringify(spec)}}]}));});
 const store=new Memory();
 const gateway=createGateway(store,{conservativeAuto});
 return {a,b,calls,store,run:(primary:Provider=a)=>gateway.planAuto('Catalogo di prova',[primary,b],false,context)};
}
test('DA1 durable auto: post-dispatch 503, malformed output and transport loss never fall back',async()=>{
 for(const first of [async()=>new Response('',{status:503}),async()=>new Response('not-json'),async()=>{throw Error('synthetic transport loss');}]){
  const f=fixture(first);
  await assert.rejects(f.run(),ProviderError);
  assert.deepEqual(f.calls,['local']);
  const state=JSON.parse(f.store.data.get('gateway.v1')!);
  assert.equal(state.counts.local,1);
  assert.deepEqual(state.cache,{});
 }
});
test('DA2 durable auto: actual HTTP 429 permits other local provider; untyped 429 does not',async()=>{
 const f=fixture(async()=>new Response('',{status:429,headers:{'Retry-After':'120'}}));
 const result=await f.run();
 assert.equal(result.routing.provider,'llamacpp');assert.deepEqual(f.calls,['local','llamacpp']);
 const g=fixture(async()=>{throw Error('unused');});
 const p={...g.a,complete:async()=>{g.calls.push('local');throw new ProviderError('not an explicit refusal',429);}};
 await assert.rejects(g.run(p),(e:unknown)=>e instanceof ProviderError&&!(e instanceof QuotaDeferral)&&e.status===429);
 assert.deepEqual(g.calls,['local']);
});
test('DA3 preflight error before dispatch may fall back; legacy fallback preserved',async()=>{
 const f=fixture(async()=>{throw Error('unused');});
 const result=await f.run({...f.a,eligible:async()=>{throw new ProviderError('preflight failure',503);}});
 assert.equal(result.routing.provider,'llamacpp');assert.deepEqual(f.calls,['llamacpp']);
 const g=fixture(async()=>new Response('',{status:503}),false);
 assert.equal((await g.run()).routing.provider,'llamacpp');assert.deepEqual(g.calls,['local','llamacpp']);
});
