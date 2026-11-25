import test from 'node:test';
import assert from 'node:assert/strict';
import {resolveModelRegistry,validateModel,providerIds,knownProvider,localProvider} from '../server/modelRegistry.ts';
const legacy=[{id:'local',prefix:'OLLAMA',model:'old'},{id:'openrouter',prefix:'OPENROUTER',model:'org/old:free',apiKey:'synthetic'}];
const config=(active='second')=>JSON.stringify({openrouter:{active,profiles:[{id:'first',model:'org/first:free'},{id:'second',model:'org/second:free',fit:{draft:7,maxInputBytes:2000}}]}});
test('M1 legacy configuration unchanged; fixed quota domains',()=>{
 assert.deepEqual(resolveModelRegistry(legacy),legacy);
 assert.deepEqual(providerIds,['local','llamacpp','groq','openrouter','cloudflare']);
 assert.equal(knownProvider('toString'),false);assert.equal(localProvider('openrouter'),false);
 assert.throws(()=>resolveModelRegistry([...legacy,legacy[0]]));
});
test('M2 active model and fit, inactive model not activated',()=>{
 const result=resolveModelRegistry(legacy,config());
 assert.equal(result.length,2);assert.deepEqual(result[0],legacy[0]);
 assert.deepEqual(result[1],{...legacy[1],model:'org/second:free',profile:'second',fitRaw:'{"draft":7,"maxInputBytes":2000}'});
});
test('M3 malformed registry, unknown group, duplicate, missing selection and invalid fit fail closed',()=>{
 for(const raw of ['', 'null','[]','{bad','{"__proto__":{}}','{"new-provider":{}}',config('missing'),JSON.stringify({local:{active:'x',profiles:[{id:'x',model:'a'},{id:'x',model:'b'}]}}),JSON.stringify({local:{active:'x',profiles:[{id:'x',model:'a',fit:{draft:11}}]}})])assert.throws(()=>resolveModelRegistry(legacy,raw));
});
test('M4 model policies apply even to inactive profiles; no override of secrets, quota, endpoint',()=>{
 for(const [id,model] of [['local','qwen-cloud'],['local','http://host'],['llamacpp','bad/alias'],['openrouter','org/paid'],['cloudflare','other'],['groq','bad model']])assert.throws(()=>validateModel(id,model));
 for(const extra of [{apiKey:'override'},{endpoint:'http://host'},{mode:'local'},{provider:'groq'},{quota:1000}])assert.throws(()=>resolveModelRegistry(legacy,JSON.stringify({openrouter:{active:'x',profiles:[{id:'x',model:'org/free:free',...extra}]}})));
 assert.throws(()=>resolveModelRegistry(legacy,JSON.stringify({openrouter:{active:'x',profiles:[{id:'x',model:'org/free:free'},{id:'y',model:'org/paid'}]}})));
});
test('M5 switching model never changes provider id, prefix or credentials',()=>{
 const a=resolveModelRegistry(legacy,config('first'))[1],b=resolveModelRegistry(legacy,config())[1];
 assert.notEqual(a.model,b.model);assert.equal(a.id,b.id);assert.equal(a.prefix,b.prefix);assert.equal(a.apiKey,b.apiKey);
 assert.equal(a.id,'openrouter');assert.equal(legacy[1].model,'org/old:free');
});
