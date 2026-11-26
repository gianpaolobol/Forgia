import assert from 'node:assert/strict';
import {test, after} from 'node:test';
import {mkdtemp, mkdir, copyFile, writeFile, rm, readFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {pathToFileURL} from 'node:url';
import {createHash} from 'node:crypto';
const base=await mkdtemp(join(tmpdir(),'forgia15-'));
after(()=>rm(base,{recursive:true,force:true}));
for(const dir of ['server','src/core']) await mkdir(join(base,dir),{recursive:true});
for(const [file,expected] of Object.entries({'server/gateway.ts':'6951141b8c466f3bc29d90c77b6e2400b85b67a4','server/routing.ts':'c063ada7b6f03ca0bdcc514001de27bb253917fd'})){
 const bytes=await readFile(file);
 assert.equal(createHash('sha1').update(`blob ${bytes.length}\0`).update(bytes).digest('hex'),expected);
 await copyFile(file,join(base,file));
}
await writeFile(join(base,'package.json'),'{"type":"module"}');
await writeFile(join(base,'server/providers.ts'),`export class ProviderError extends Error { constructor(message, status) { super(message); this.status=status; } }
export const localProvider=id=>id==='local'||id==='llamacpp';
export const providerIds=['local','llamacpp','groq','openrouter','cloudflare'];`);
await writeFile(join(base,'src/core/spec.ts'),`export const text=v=>v; export const validateSpec=v=>{ if(!v||v.name!=='fixture') throw Error('invalid fixture'); return v; };`);
const {createGateway}=await import(pathToFileURL(join(base,'server/gateway.ts')));
const {ProviderError}=await import(pathToFileURL(join(base,'server/providers.ts')));
const context={kind:'catalog',phase:'draft'};
const store=()=>{const m=new Map();return {getItem:async k=>m.get(k)??null,setItem:async(k,v)=>{m.set(k,v);}};};
function provider(id, action){let calls=0;return {id,model:'fixture',mode:id==='local'?'local':'free',eligible:async()=>true,complete:async()=>{calls++;return action();},get calls(){return calls;}};}
const failure=status=>()=>{throw new ProviderError('synthetic HTTP failure',status);};
const success=()=>JSON.stringify({name:'fixture'});
const statusIs=status=>e=>{assert.equal(e.status,status);return true;};
test('manual auth failure preserves 401',async()=>{
 const p=provider('groq',failure(401));await assert.rejects(createGateway(store()).plan('synthetic',p,true),statusIs(401));assert.equal(p.calls,1);
});
test('auto auth failure must not be mislabeled quota 429',async()=>{
 const p=provider('groq',failure(401));await assert.rejects(createGateway(store()).planAuto('synthetic',[p],true,context),e=>{assert.notEqual(e.status,429);return true;});
});
test('auto service failure must not be mislabeled quota 429',async()=>{
 const p=provider('groq',failure(503));await assert.rejects(createGateway(store()).planAuto('synthetic',[p],true,context),e=>{assert.notEqual(e.status,429);return true;});
});
test('auto invalid JSON must not be mislabeled quota 429',async()=>{
 const p=provider('groq',()=>'{');await assert.rejects(createGateway(store()).planAuto('synthetic',[p],true,context),e=>{assert.notEqual(e.status,429);return true;});
});
test('auto actual quota failure retains 429',async()=>{
 const p=provider('groq',failure(429));await assert.rejects(createGateway(store()).planAuto('synthetic',[p],true,context),statusIs(429));assert.equal(p.calls,1);
});
test('authorized fallback after temporary unavailability remains possible',async()=>{
 const p=provider('groq',failure(503)),q=provider('local',success);
 const out=await createGateway(store()).planAuto('synthetic',[p,q],true,context);
 assert.equal(out.routing.provider,'local');assert.deepEqual(out.routing.skipped,['groq']);assert.equal(p.calls,1);assert.equal(q.calls,1);
});
