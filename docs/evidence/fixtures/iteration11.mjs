// Run from repository: node --experimental-strip-types --test docs/evidence/fixtures/iteration11.mjs
// Or place this file next to server/ in an isolated copy of PR #4 sources.
import test from 'node:test';
import assert from 'node:assert/strict';
import {existsSync} from 'node:fs';
const path = existsSync(new URL('./server/providers.ts', import.meta.url))
  ? './server/providers.ts' : '../../../server/providers.ts';
const {createProvider} = await import(path);
const signal = () => new AbortController().signal;
const spec = JSON.stringify({name:'Catalogo sintetico',idea:'Catalogo sintetico',kind:'catalog',quiz:false,items:[{name:'A',category:'B',color:''}]});
function ollama(done, done_reason) {
  return createProvider({id:'local',model:'fixture'},async (url,init)=>{
    assert.equal(url,'http://127.0.0.1:11434/api/chat');
    assert.equal(init.redirect,'error');
    return Response.json({done,done_reason,message:{content:spec}});
  });
}
function price(pricing) {
  return createProvider({id:'openrouter',model:'fixture/model:free',apiKey:'synthetic'}, async (url)=>{
    assert.equal(url,'https://openrouter.ai/api/v1/models');
    return Response.json({data:[{id:'fixture/model:free',pricing}]});
  });
}
test('Ollama stop with valid-looking output',async()=>assert.equal(await ollama(true,'stop').complete('fixture',signal()),spec));
test('Ollama length must reject even valid-looking JSON',async()=>assert.rejects(ollama(true,'length').complete('fixture',signal()), /troncata|incompleta/i));
test('Ollama incomplete response must reject',async()=>assert.rejects(ollama(false,'stop').complete('fixture',signal()), /incompleta/i));
test('llama.cpp length must reject',async()=>{
  const p=createProvider({id:'llamacpp',model:'fixture'},async()=>Response.json({choices:[{finish_reason:'length',message:{content:spec}}]}));
  await assert.rejects(p.complete('fixture',signal()), /troncata/i);
});
test('OpenRouter verified zero price is eligible',async()=>assert.equal(await price({prompt:'0',completion:'0'}).eligible(signal()),true));
test('OpenRouter missing price must reject',async()=>assert.rejects(price({prompt:'0'}).eligible(signal()), /prezzo/i));
test('OpenRouter nonzero secondary price must reject',async()=>assert.rejects(price({prompt:'0',completion:'0',request:'0.01'}).eligible(signal()), /prezzo/i));
