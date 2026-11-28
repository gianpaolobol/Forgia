// Acceptance-only runtime selection. No arbitrary endpoints, downloads, or model inference.
import assert from 'node:assert/strict';

export function parseLocalRuntime(args){
 const legacy=args.length===3&&args[0]==='--confirm-local-runtime'&&args[1]==='--model';
 const ollama=args.length===4&&args[0]==='--confirm-local-runtime'&&args[1]==='--confirm-ollama-no-cloud'&&args[2]==='--model';
 const model=legacy?args[2]:ollama?args[3]:undefined;
 if(typeof model!=='string'||!/^[a-zA-Z0-9_.:-]{1,150}$/.test(model)||(ollama&&(/cloud|https?:/i.test(model)||!(/^[a-zA-Z0-9_.-]+:[a-zA-Z0-9_.-]+$/.test(model)))))throw Error('explicit-local-runtime-and-alias-required');
 return {provider:ollama?'local':'llamacpp',model};
}

const remoteMetadata=value=>Boolean(value?.remote_host||value?.remote_model);
export async function probeLocalRuntime(runtime,transport=fetch){
 const {provider,model}=runtime;
 // Revalidate direct callers before any connection.
 const checked=parseLocalRuntime(provider==='local'?['--confirm-local-runtime','--confirm-ollama-no-cloud','--model',model]:['--confirm-local-runtime','--model',model]);
 assert.equal(checked.provider,provider);
 const request=(url,opts={})=>transport(url,{...opts,redirect:'error',signal:AbortSignal.timeout(5000)});
 const json=async(url,opts)=>{const r=await request(url,opts);assert.equal(r.status,200);return r.json();};
 if(provider==='llamacpp'){
  const health=await request('http://127.0.0.1:8080/health');
  assert.equal(health.status,200);await health.body?.cancel();
  const models=await json('http://127.0.0.1:8080/v1/models');
  assert.ok(Array.isArray(models?.data)&&models.data.some(m=>m.id===model));
  return;
 }
 const tags=await json('http://127.0.0.1:11434/api/tags');
 const matches=Array.isArray(tags?.models)?tags.models.filter(m=>m?.name===model||m?.model===model):[];
 assert.equal(matches.length,1);
 const entry=matches[0];
 assert.ok(typeof entry.digest==='string'&&/^(?:sha256:)?[a-f0-9]{64}$/i.test(entry.digest)&&Number.isSafeInteger(entry.size)&&entry.size>0&&!remoteMetadata(entry));
 const info=await json('http://127.0.0.1:11434/api/show',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({model})});
 assert.ok(info&&typeof info==='object'&&!remoteMetadata(info)&&typeof info.model_info==='object'&&info.model_info!==null&&!Array.isArray(info.model_info)&&Object.keys(info.model_info).length>0);
 // Runtime metadata is a sanity check, not attestation: operator must disable cloud in Ollama itself.
}
