import test,{type TestContext} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync,writeFileSync,unlinkSync,readFileSync,readdirSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {openSuperhandyLedger} from '../server/superhandyLedger.ts';
import {runLocalSpec,resumeLocalSpec,prepareSuperhandyArtifacts} from '../server/superhandyBridge.ts';
import {localSpecAuthorization} from '../server/superhandyGrant.ts';
const h='a'.repeat(64),jobId='00000000-0000-4000-8000-000000000001';
const meta={mode:'free-only',localDevelopmentOnly:true,durableLocal:true,durableModelPin:true,providers:[{id:'local',model:'qwen',configured:true}]};
const result={status:'done',result:{spec:{name:'Demo'},routing:{provider:'local',model:'qwen'}}};
function fixture(t:TestContext){
 const root=mkdtempSync(join(tmpdir(),'forgia-grant-bridge-')),path=join(root,'grant.json');let now=1000;
 const db=openSuperhandyLedger(join(root,'ledger.sqlite'),true,()=>now);
 t.after(()=>{db.close();rmSync(root,{recursive:true,force:true});});
 const baselineSha=db.install({project:'demo',planner:'planner',reviewer:'reviewer',executors:['one','two'],tasks:[{id:'a',depends:[],criterion:'Catalogo A'}]});db.approve('reviewer',baselineSha,h);
 const artifactDir=prepareSuperhandyArtifacts(root,'demo');
 const grant={version:1,baselineSha,actor:'one',taskId:'a',provider:'local',model:'qwen',expiresAt:1000000};
 const write=(value:unknown=grant)=>writeFileSync(path,JSON.stringify(value),{mode:0o600});write();
 const auth=()=>localSpecAuthorization(path,()=>now);
 const options={actor:'one',taskId:'a',provider:'local' as const,artifactDir,verifySpec:(v:unknown)=>v,pollMs:0};
 return {db,grant,path,write,auth,options,advance:()=>{now+=300001;}};
}
test('G5 wrong scope does not claim or POST',async t=>{
 const f=fixture(t);let calls=0;
 const transport:typeof fetch=async input=>{calls++;assert.ok(String(input).endsWith('/providers'));return Response.json(meta);};
 await assert.rejects(runLocalSpec(f.db,{...f.options,actor:'two',authorization:f.auth(),transport}));
 assert.equal(calls,1);assert.equal(f.db.inspect().tasks[0].status,'queued');assert.equal(readdirSync(f.options.artifactDir).length,0);
});
test('G5 revocation after dispatch marker prevents POST',async t=>{
 const f=fixture(t);let posts=0;
 const transport:typeof fetch=async input=>{if(String(input).endsWith('/providers'))return Response.json(meta);posts++;throw Error('unexpected POST');};
 const db={...f.db,dispatch:(...args:Parameters<typeof f.db.dispatch>)=>{f.db.dispatch(...args);unlinkSync(f.path);}};
 await assert.rejects(runLocalSpec(db,{...f.options,authorization:f.auth(),transport}),/Grant/);
 assert.equal(posts,0);f.advance();assert.equal(f.db.inspect().tasks[0].status,'uncertain');
});
test('G5 revocation after GET rejects result and preserves receipt',async t=>{
 const f=fixture(t);let posts=0;
 const transport:typeof fetch=async input=>{const p=new URL(String(input)).pathname;if(p==='/providers')return Response.json(meta);if(p==='/jobs'){posts++;return Response.json({id:jobId});}unlinkSync(f.path);return Response.json(result);};
 await assert.rejects(runLocalSpec(f.db,{...f.options,authorization:f.auth(),transport}),/Grant/);
 assert.equal(posts,1);assert.equal(f.db.inspect().tasks[0].status,'dispatched');assert.equal(readdirSync(f.options.artifactDir).length,2);
 f.advance();assert.equal(f.db.inspect().tasks[0].status,'uncertain');
});
test('G4/G5 grant-bound receipt requires original grant on resume, no replay',async t=>{
 const f=fixture(t);let posts=0,gets=0,done=false;
 const transport:typeof fetch=async (input,init)=>{const p=new URL(String(input)).pathname;if(p==='/providers')return Response.json(meta);if(p==='/jobs'){posts++;assert.equal(init?.method,'POST');assert.equal(JSON.parse(String(init?.body)).expectedModel,'qwen');return Response.json({id:jobId});}gets++;return Response.json(done?result:{status:'queued',nextEligibleAt:Date.now()+60000});};
 assert.equal((await runLocalSpec(f.db,{...f.options,authorization:f.auth(),transport})).status,'deferred');
 const intent=JSON.parse(readFileSync(join(f.options.artifactDir,readdirSync(f.options.artifactDir).find(n=>n.endsWith('.intent.json'))!),'utf8'));
 assert.match(intent.grantDigest,/^[a-f0-9]{64}$/);f.advance();done=true;const before=gets;
 await assert.rejects(resumeLocalSpec(f.db,{...f.options,transport}));
 f.write({...f.grant,expiresAt:2000000});await assert.rejects(resumeLocalSpec(f.db,{...f.options,authorization:f.auth(),transport}));assert.equal(gets,before);
 f.write();const out=await resumeLocalSpec(f.db,{...f.options,authorization:f.auth(),transport});assert.equal(out.status,'submitted');assert.equal(posts,1);assert.equal(f.db.inspect().tasks[0].status,'submitted');
 if(out.status!=='submitted')throw Error();f.db.review('reviewer','a',out.evidence,'accept',h);assert.equal(f.db.inspect().tasks[0].status,'accepted');
});
test('G6 manual trusted path remains compatible, cannot be retroactively grant-bound',async t=>{
 const f=fixture(t);let posts=0,done=false;
 const transport:typeof fetch=async input=>{const p=new URL(String(input)).pathname;if(p==='/providers')return Response.json(meta);if(p==='/jobs'){posts++;return Response.json({id:jobId});}return Response.json(done?result:{status:'queued',nextEligibleAt:Date.now()+60000});};
 assert.equal((await runLocalSpec(f.db,{...f.options,transport})).status,'deferred');f.advance();done=true;
 await assert.rejects(resumeLocalSpec(f.db,{...f.options,authorization:f.auth(),transport}));
 assert.equal((await resumeLocalSpec(f.db,{...f.options,transport})).status,'submitted');assert.equal(posts,1);
});
