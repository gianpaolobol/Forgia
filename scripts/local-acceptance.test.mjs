import assert from 'node:assert/strict';
import {test} from 'node:test';
import {parseArgs,acceptsResult,run} from './local-acceptance.mjs';

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
 assert.equal(r.pass,false);assert.equal(r.failedStage,'preflight');assert.deepEqual(r.checks,{});
});
