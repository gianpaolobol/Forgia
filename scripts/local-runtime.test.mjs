import assert from 'node:assert/strict';
import {test} from 'node:test';
import {createServer} from 'node:http';
import {parseLocalRuntime,probeLocalRuntime} from './local-runtime.mjs';
const alias='qwen2.5:0.5b';
const args=['--confirm-local-runtime','--confirm-ollama-no-cloud','--model',alias];
const runtime=parseLocalRuntime(args);
const entry={name:alias,model:alias,digest:'a'.repeat(64),size:123};
const info={model_info:{'general.architecture':'qwen2'}};
const fixture=(tags={models:[entry]},show=info)=>{
 const calls=[];
 const transport=async(url,opts)=>{calls.push({url,opts});return new Response(JSON.stringify(url.endsWith('/api/tags')?tags:show));};
 return {calls,transport};
};
test('LR1: explicit Ollama cloud-disable confirmation, exact tagged alias, legacy llama.cpp unchanged',()=>{
 assert.deepEqual(runtime,{provider:'local',model:alias});
 assert.deepEqual(parseLocalRuntime(['--confirm-local-runtime','--model','qwen']),{provider:'llamacpp',model:'qwen'});
 for(const bad of [args.slice(1),[...args,'extra'],...['qwen','qwen:cloud','qwen:',':tag','qwen:a:b','https:example','vendor/qwen:latest','qwen:bad tag','qwen:\0'].map(m=>[...args.slice(0,3),m])])assert.throws(()=>parseLocalRuntime(bad));
});
test('LR2: Ollama probes only tags and show without credentials or inference',async()=>{
 const {calls,transport}=fixture();await probeLocalRuntime(runtime,transport);
 assert.deepEqual(calls.map(c=>c.url),['http://127.0.0.1:11434/api/tags','http://127.0.0.1:11434/api/show']);
 assert.equal(calls[1].opts.method,'POST');assert.deepEqual(JSON.parse(calls[1].opts.body),{model:alias});
 for(const c of calls){assert.equal(c.opts.redirect,'error');assert.equal(c.opts.headers?.Authorization,undefined);assert.ok(c.opts.signal);}
});
test('LR3: missing, duplicate, remote or invalid local listing rejected before show',async()=>{
 for(const models of [[],[entry,entry],[{...entry,name:'other',model:'other'}],[{...entry,remote_host:'https://ollama.com'}],[{...entry,remote_model:'remote'}],[{...entry,size:0}],[{...entry,digest:'bad'}]]){
  const {calls,transport}=fixture({models});await assert.rejects(probeLocalRuntime(runtime,transport));assert.equal(calls.length,1);
 }
});
test('LR4: remote or empty model details and HTTP failure rejected',async()=>{
 for(const show of [{...info,remote_host:'https://ollama.com'},{...info,remote_model:'remote'},{model_info:{}},{model_info:[]},null]){
  const {calls,transport}=fixture(undefined,show);await assert.rejects(probeLocalRuntime(runtime,transport));assert.equal(calls.length,2);
 }
 await assert.rejects(probeLocalRuntime(runtime,async()=>new Response('{}',{status:503})));
});
test('LR5: direct callers cannot bypass provider or alias checks; llama.cpp endpoints preserved',async()=>{
 const {calls,transport}=fixture();await assert.rejects(probeLocalRuntime({provider:'openrouter',model:'qwen'},transport));await assert.rejects(probeLocalRuntime({provider:'local',model:'qwen:cloud'},transport));assert.equal(calls.length,0);
 const seen=[];await probeLocalRuntime({provider:'llamacpp',model:'qwen'},async(url)=>{seen.push(url);return new Response(JSON.stringify({data:[{id:'qwen'}]}));});assert.deepEqual(seen,['http://127.0.0.1:8080/health','http://127.0.0.1:8080/v1/models']);
});
test('LR6: real loopback HTTP, no inference or model download',async()=>{
 const seen=[];const server=createServer(async(req,res)=>{
  seen.push(req.url);res.setHeader('content-type','application/json');
  if(req.url==='/api/tags'&&req.method==='GET')res.end(JSON.stringify({models:[entry]}));
  else if(req.url==='/api/show'&&req.method==='POST'){let raw='';for await(const b of req)raw+=b;assert.deepEqual(JSON.parse(raw),{model:alias});res.end(JSON.stringify(info));}
  else {res.writeHead(404);res.end('{}');}
 });
 await new Promise((ok,fail)=>{server.once('error',fail);server.listen(0,'127.0.0.1',ok);});
 try{await probeLocalRuntime(runtime,(url,opts)=>{assert.ok(url.startsWith('http://127.0.0.1:11434/'));return fetch('http://127.0.0.1:'+server.address().port+new URL(url).pathname,opts);});assert.deepEqual(seen,['/api/tags','/api/show']);}
 finally{server.closeAllConnections();await new Promise(ok=>server.close(ok));}
});
