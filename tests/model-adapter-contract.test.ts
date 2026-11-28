import test from 'node:test';
import assert from 'node:assert/strict';
import {createProvider} from '../server/providers.ts';
import {resolveModelRegistry,validateModel} from '../server/modelRegistry.ts';

const forbiddenTransport=async()=>{throw Error('Unexpected transport');};
const config=(id:string,model:string)=>({id,model,prefix:id.toUpperCase(),apiKey:'synthetic',freePlanConfirmed:true,accountId:'a'.repeat(32)});

test('MA1 legacy and adapter reject invalid model identifiers before any transport',()=>{
 for(const [id,model] of [['local','local\0model'],['groq','bad model'],['groq','bad\x7fmodel'],['openrouter','https://example.invalid:free'],['openrouter','model:free']]){
  assert.throws(()=>createProvider(config(id,model),forbiddenTransport),undefined,`${id}: ${JSON.stringify(model)}`);
 }
});
test('MA2 malformed OpenRouter IDs are rejected even in inactive registry profiles',()=>{
 const legacy=[config('openrouter','example/model:free')];
 for(const model of ['model:free','https://example.invalid:free','example/a/b:free','example/:free','example/model:FREE']){
  assert.throws(()=>validateModel('openrouter',model));
  assert.throws(()=>resolveModelRegistry(legacy,JSON.stringify({openrouter:{active:'good',profiles:[{id:'good',model:'example/model:free'},{id:'bad',model}]}})));
 }
});
test('MA3 valid registry profiles preserve fixed provider identities and model pins',()=>{
 for(const [id,model] of [['local','qwen2.5:7b'],['llamacpp','fixture-local'],['groq','openai/gpt-oss-20b'],['openrouter','example/model:free'],['cloudflare','@cf/meta/llama-3.1-8b-instruct']]){
  const legacy=config(id,model);
  const [resolved]=resolveModelRegistry([legacy],JSON.stringify({[id]:{active:'current',profiles:[{id:'current',model}]}}));
  const provider=createProvider(resolved,forbiddenTransport);
  assert.equal(provider.id,id);assert.equal(provider.model,model);assert.equal(resolved.apiKey,legacy.apiKey);
  assert.equal(provider.mode,['local','llamacpp'].includes(id)?'local':'free');
 }
});
test('MA4 catalog price check and zero-price request guard remain active',async()=>{
 let calls=0;
 const provider=createProvider(config('openrouter','example/model:free'),async(url,init)=>{
  calls++;
  if(url.endsWith('/models'))return Response.json({data:[{id:'example/model:free',pricing:{prompt:'0',completion:'0'}}]});
  assert.equal(url,'https://openrouter.ai/api/v1/chat/completions');
  assert.deepEqual(JSON.parse(init!.body as string).provider.max_price,{prompt:0,completion:0,request:0});
  return Response.json({choices:[{message:{content:'{}'}}]});
 });
 assert.equal(await provider.eligible(),true);
 assert.equal(await provider.complete('synthetic',AbortSignal.timeout(1000)),'{}');assert.equal(calls,2);
 const paid=createProvider(config('openrouter','example/model:free'),async()=>Response.json({data:[{id:'example/model:free',pricing:{prompt:'1',completion:'0'}}]}));
 await assert.rejects(paid.eligible(),/gratuit/i);
});
