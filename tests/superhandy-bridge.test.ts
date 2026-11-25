import test,{type TestContext} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync,mkdirSync,readdirSync,readFileSync,statSync,chmodSync,writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createHash} from 'node:crypto';
import {openSuperhandyLedger} from '../server/superhandyLedger.ts';
import {runLocalSpec,resumeLocalSpec,prepareSuperhandyArtifacts} from '../server/superhandyBridge.ts';
import {validateSpec} from '../src/core/spec.ts';
const h='a'.repeat(64),jobId='00000000-0000-4000-8000-000000000001';
const plan={project:'demo',planner:'planner',reviewer:'reviewer',executors:['one','two'],tasks:[{id:'a',depends:[],criterion:'Catalogo A'},{id:'b',depends:[],criterion:'Catalogo B'},{id:'c',depends:['b'],criterion:'Catalogo C'}]};
const spec={name:'B',idea:'Catalogo B',kind:'catalog',quiz:false,items:[{name:'X',category:'Y',color:''}]};
const meta={mode:'free-only',localDevelopmentOnly:true,durableLocal:true,durableModelPin:true,providers:[{id:'local',model:'qwen',configured:true}]};
const response=(v:unknown)=>Response.json(v);
function fixture(t:TestContext,approved=true){
 const dir=mkdtempSync(join(tmpdir(),'forgia-bridge-'));let now=100;
 const db=openSuperhandyLedger(join(dir,'ledger.sqlite'),true,()=>now);
 t.after(()=>{db.close();rmSync(dir,{recursive:true,force:true});});
 const sha=db.install(plan);if(approved)db.approve('reviewer',sha,h);
 const artifactDir=prepareSuperhandyArtifacts(dir,'demo');
 return {db,artifactDir,sha,advance:()=>{now+=300001;},options:{actor:'one',taskId:'b',provider:'local' as const,artifactDir,verifySpec:validateSpec,pollMs:0}};
}
test('BSH1 preflight refuses non-durable or unconfigured gateway before claim',async t=>{
 const {db,options,artifactDir}=fixture(t);
 for(const m of [{...meta,durableLocal:false},{...meta,durableModelPin:false},{...meta,providers:[]},{...meta,localDevelopmentOnly:false}]){
  await assert.rejects(runLocalSpec(db,{...options,transport:async()=>response(m)}));
 }
 assert.equal(db.inspect().events.filter(e=>e.action==='claim').length,0);assert.deepEqual(readdirSync(artifactDir),[]);
});
test('BSH2/3 one local POST, persistent receipt and verified artifact; review separate',async t=>{
 const {db,options,artifactDir}=fixture(t);let posts=0,polls=0;
 const transport:typeof fetch=async (input,init)=>{
  const u=new URL(String(input));assert.equal(u.origin,'http://127.0.0.1:8787');assert.equal(init?.redirect,'error');
  if(u.pathname==='/providers')return response(meta);
  if(u.pathname==='/jobs'){
   posts++;assert.equal(init?.method,'POST');assert.equal(db.inspect().tasks.find(r=>r.id==='b')?.status,'dispatched');
   const b=JSON.parse(String(init?.body));assert.equal(b.provider,'local');assert.equal(b.expectedModel,'qwen');assert.equal(b.cloudConsent,false);assert.equal(b.idea,'Catalogo B');
   assert.ok(new Headers(init?.headers).get('idempotency-key')?.startsWith('sh:'));return response({id:jobId});
  }
  assert.equal(u.pathname,'/jobs/'+jobId);polls++;
  return response(polls===1?{status:'running'}:{status:'done',result:{spec,routing:{provider:'local',model:'qwen'}}});
 };
 const out=await runLocalSpec(db,{...options,transport});assert.equal(out.status,'submitted');assert.equal(posts,1);assert.equal(polls,2);
 if(out.status!=='submitted')throw Error();
 const names=readdirSync(artifactDir);assert.equal(names.length,3);
 const file=join(artifactDir,names.find(n=>n.endsWith('.result.json'))!);
 const content=readFileSync(file);assert.equal(createHash('sha256').update(content).digest('hex'),out.evidence);
 assert.deepEqual(JSON.parse(content.toString()).spec,spec);
 if(process.platform!=='win32')assert.equal(statSync(file).mode&0o077,0);
 assert.equal(db.inspect().tasks.find(r=>r.id==='a')?.status,'queued');
 assert.equal(db.claim('two',60000,'c'),null);
 assert.throws(()=>db.review('one','b',out.evidence,'accept',h));
 db.review('reviewer','b',out.evidence,'accept',h);assert.equal(db.claim('two',60000,'c')?.task.id,'c');
});
test('BSH4 lost POST response never repeats or hands off a dispatched task',async t=>{
 const {db,options,advance,artifactDir}=fixture(t);let posts=0;
 const transport:typeof fetch=async input=>{if(String(input).endsWith('/providers'))return response(meta);posts++;throw Error('lost');};
 await assert.rejects(runLocalSpec(db,{...options,transport}));
 assert.equal(posts,1);assert.equal(readdirSync(artifactDir).length,1);
 advance();assert.equal(db.inspect().tasks.find(r=>r.id==='b')?.status,'uncertain');
 assert.deepEqual(await runLocalSpec(db,{...options,transport}),{status:'idle'});assert.equal(posts,1);
});
test('BSH4 quota deferral preserves gateway receipt and does not resubmit',async t=>{
 const {db,options,artifactDir,advance}=fixture(t);let posts=0;
 const transport:typeof fetch=async input=>{const u=new URL(String(input));if(u.pathname==='/providers')return response(meta);if(u.pathname==='/jobs'){posts++;return response({id:jobId});}return response({status:'queued',nextEligibleAt:Date.now()+60000});};
 assert.equal((await runLocalSpec(db,{...options,transport})).status,'deferred');assert.equal(readdirSync(artifactDir).length,2);
 advance();assert.deepEqual(await runLocalSpec(db,{...options,transport}),{status:'idle'});assert.equal(posts,1);
});
test('BSH4 wrong model or invalid spec never becomes submitted',async t=>{
 for(const bad of [{spec,routing:{provider:'local',model:'other'}},{spec:{},routing:{provider:'local',model:'qwen'}}]){
  const {db,options,artifactDir}=fixture(t);
  const transport:typeof fetch=async input=>{const u=new URL(String(input));return response(u.pathname==='/providers'?meta:u.pathname==='/jobs'?{id:jobId}:{status:'done',result:bad});};
  await assert.rejects(runLocalSpec(db,{...options,transport}));assert.equal(db.inspect().tasks.find(r=>r.id==='b')?.status,'dispatched');assert.equal(readdirSync(artifactDir).length,2);
 }
});
test('BSH5 unapproved baseline and unmet dependency cannot send a POST',async t=>{
 const transport:typeof fetch=async input=>{assert.ok(String(input).endsWith('/providers'));return response(meta);};
 const one=fixture(t,false);await assert.rejects(runLocalSpec(one.db,{...one.options,transport}));
 const two=fixture(t);assert.deepEqual(await runLocalSpec(two.db,{...two.options,taskId:'c',transport}),{status:'idle'});
});
test('BSH6 rejects non-private artifact directory before dispatch',async t=>{
 if(process.platform==='win32'){t.skip('POSIX mode check');return;}
 const {db,options,artifactDir}=fixture(t);chmodSync(artifactDir,0o755);
 await assert.rejects(runLocalSpec(db,{...options,transport:async()=>response(meta)}));assert.equal(db.inspect().events.filter(e=>e.action==='claim').length,0);
});

test('BSH7 read-only resume after expiry reconciles original receipt, not acceptance',async t=>{
 const {db,options,advance,artifactDir}=fixture(t);let posts=0,done=false;
 const transport:typeof fetch=async (input,init)=>{const u=new URL(String(input));if(u.pathname==='/providers')return response(meta);if(u.pathname==='/jobs'){posts++;return response({id:jobId});}assert.equal(u.pathname,'/jobs/'+jobId);if(done)assert.equal(init?.method,'GET');return response(done?{status:'done',result:{spec,routing:{provider:'local',model:'qwen'}}}:{status:'queued',nextEligibleAt:Date.now()+60000});};
 assert.equal((await runLocalSpec(db,{...options,transport})).status,'deferred');
 advance();assert.equal(db.inspect().tasks.find(r=>r.id==='b')?.status,'uncertain');
 assert.equal((await resumeLocalSpec(db,{...options,transport})).status,'pending');
 done=true;const out=await resumeLocalSpec(db,{...options,transport});assert.equal(out.status,'submitted');assert.equal(posts,1);assert.equal(readdirSync(artifactDir).length,3);
 assert.equal(db.inspect().events.filter(e=>e.action==='reconcile').length,1);
 assert.equal(db.claim('two',60000,'c'),null);if(out.status!=='submitted')throw Error();
 db.review('reviewer','b',out.evidence,'accept',h);assert.equal(db.claim('two',60000,'c')?.task.id,'c');
});
test('BSH8 receipt tampering, different actor and stale fence fail closed',async t=>{
 const {db,options,advance,artifactDir}=fixture(t);let calls=0;
 const transport:typeof fetch=async input=>{calls++;const u=new URL(String(input));return response(u.pathname==='/providers'?meta:u.pathname==='/jobs'?{id:jobId}:{status:'queued',nextEligibleAt:Date.now()+60000});};
 await runLocalSpec(db,{...options,transport});advance();const before=calls;
 await assert.rejects(resumeLocalSpec(db,{...options,actor:'two',transport}));
 assert.throws(()=>db.reconcile({id:'b',actor:'one',fence:2},h));assert.throws(()=>db.reconcile({id:'b',actor:'two',fence:1},h));
 const receipt=join(artifactDir,readdirSync(artifactDir).find(n=>n.endsWith('.receipt.json'))!);
 const saved=JSON.parse(readFileSync(receipt,'utf8'));writeFileSync(receipt,JSON.stringify({...saved,jobId:'00000000-0000-4000-8000-000000000002'}));
 await assert.rejects(resumeLocalSpec(db,{...options,transport}));assert.equal(calls,before);assert.equal(db.inspect().tasks.find(r=>r.id==='b')?.status,'uncertain');
});
test('BSH9 resume after result file was synced but ledger submit failed; no overwrite or replay',async t=>{
 const {db,options,advance,artifactDir}=fixture(t);let posts=0;
 const transport:typeof fetch=async (input,init)=>{const u=new URL(String(input));if(u.pathname==='/providers')return response(meta);if(u.pathname==='/jobs'){posts++;assert.equal(init?.method,'POST');return response({id:jobId});}return response({status:'done',result:{spec,routing:{provider:'local',model:'qwen'}}});};
 await assert.rejects(runLocalSpec({...db,submit:()=>{throw Error('simulated submit interruption');}},{...options,transport}));
 const path=join(artifactDir,readdirSync(artifactDir).find(n=>n.endsWith('.result.json'))!),saved=readFileSync(path);
 advance();const out=await resumeLocalSpec(db,{...options,transport});assert.equal(out.status,'submitted');assert.equal(posts,1);assert.deepEqual(readFileSync(path),saved);
 if(out.status!=='submitted')throw Error();assert.equal(out.evidence,createHash('sha256').update(saved).digest('hex'));
});
