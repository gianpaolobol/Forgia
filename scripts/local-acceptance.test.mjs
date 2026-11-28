import assert from 'node:assert/strict';
import {test} from 'node:test';
import {parseArgs,parseCloudArgs,acceptsResult,run,runCloud} from './local-acceptance.mjs';

test('LA1 explicit local runtime and alias required; URL, whitespace and cloud flags rejected',()=>{
 assert.equal(parseArgs(['--confirm-local-runtime','--model','qwen2.5-0.5b-instruct']),'qwen2.5-0.5b-instruct');
 for(const args of [[],['--model','qwen'],['--confirm-local-runtime','--model','https://example.org'],['--confirm-local-runtime','--model','a b'],['--confirm-local-runtime','--model','qwen','--cloud']])assert.throws(()=>parseArgs(args));
});
test('LA2 acceptance rejects cached, wrong model/provider, invalid or unrelated generated catalog',()=>{
 const job={status:'done',result:{cached:false,routing:{provider:'llamacpp',model:'qwen'},spec:{kind:'catalog',name:'Catalogo prova Forgia',quiz:false,items:[{name:'Alba',category:'A',color:''}]}}};
 assert.equal(acceptsResult(job,'qwen'),true);
 for(const change of [
  j=>{j.status='queued';},j=>{j.result.cached=true;},j=>{j.result.routing.model='other';},j=>{j.result.routing.provider='groq';},
  j=>{j.result.spec.items=[];},j=>{j.result.spec.name='Other';},j=>{j.result.spec.items[0].color='red';},j=>{j.result.spec.quiz=true;},
 ]){const copy=structuredClone(job);change(copy);assert.equal(acceptsResult(copy,'qwen'),false);}
});
test('LA3 unconfirmed invocation fails before network and returns redacted stage',async()=>{
 const r=await run([]);
 assert.equal(r.pass,false);assert.equal(r.failedStage,'preflight');assert.deepEqual(r.checks,{});assert.equal(r.dispatchMayHaveOccurred,false);assert.equal(r.inferenceCheckpoint,undefined);
});


test('CA1 cloud acceptance requires both consent flags and a strict :free model',()=>{
 const args=['--confirm-free-quota','--consent-synthetic-cloud','--model','vendor/model:free'];
 assert.equal(parseCloudArgs(args),'vendor/model:free');
 for(const bad of [[],args.slice(1),[...args,'extra'],[...args.slice(0,3),'vendor/model'],[...args.slice(0,3),'https://openrouter.ai:free'],[...args.slice(0,3),'vendor/model:FREE']])assert.throws(()=>parseCloudArgs(bad));
 assert.throws(()=>parseArgs(args));
});
test('CA2 cloud acceptance requires real uncached pinned provider result',()=>{
 const job={status:'done',result:{cached:false,routing:{provider:'openrouter',model:'vendor/model:free'},spec:{kind:'catalog',name:'Catalogo prova Forgia',quiz:false,items:[{name:'Alba',category:'A',color:''}]}}};
 assert.ok(acceptsResult(job,'vendor/model:free','openrouter'));
 assert.equal(acceptsResult(job,'vendor/model:free'),false);
 job.result.cached=true;assert.equal(acceptsResult(job,'vendor/model:free','openrouter'),false);
});
test('CA3 no consent fails before any credential or network access',async()=>{
 const result=await runCloud([]);
 assert.equal(result.pass,false);assert.equal(result.failedStage,'preflight');assert.deepEqual(result.checks,{});assert.equal(result.model,undefined);assert.equal(result.dispatchMayHaveOccurred,false);assert.equal(result.reconciliationRequired,false);assert.equal(result.inferenceCheckpoint,undefined);
});
