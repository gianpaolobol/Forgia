// Dedicated integration test: requires free loopback ports 8787 and 11434.
// No user data, model downloads, real provider calls, or inherited API keys.
import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {spawn,execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {createHash} from 'node:crypto';
import {once} from 'node:events';
import {mkdtemp,mkdir,rm,writeFile,readFile,readdir} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {fileURLToPath} from 'node:url';
const root=fileURLToPath(new URL('../',import.meta.url));
const dir=await mkdtemp(join(tmpdir(),'forgia-http-'));
const session='00000000-0000-0000-0000-000000000001';
const spec={name:'Catalogo',idea:'Catalogo di prova',kind:'catalog',quiz:false,items:[{name:'A',category:'A',color:''}]};
let calls=0,child,rateLimited=false;
const fake=createServer(async(req,res)=>{
 for await(const _ of req) { /* consume synthetic request */ }
 calls++;
 if(rateLimited){res.writeHead(429,{'Retry-After':'120'});res.end();return;}
 res.setHeader('content-type','application/json');
 res.end(JSON.stringify({done:true,message:{content:JSON.stringify(spec)}}));
});
const delay=ms=>new Promise(r=>setTimeout(r,ms));
const env={PATH:process.env.PATH,SystemRoot:process.env.SystemRoot,FORGIA_DATA_DIR:dir,FORGIA_SQLITE_LOCAL:'1',OLLAMA_MODEL:'fixture-local'};
async function start(extra={}) {
 child=spawn(process.execPath,['--experimental-strip-types','server/main.ts'],{cwd:root,env:{...env,...extra},stdio:['ignore','pipe','pipe']});
 let out='',err='';
 child.stdout.on('data',b=>{out+=b;});child.stderr.on('data',b=>{err+=b;});
 for(let i=0;i<100;i++) {
  if(child.exitCode!==null||child.signalCode!==null) throw Error('Gateway terminato: '+err);
  if(out.includes('Gateway gratuito di sviluppo')) return;
  await delay(50);
 }
 throw Error('Gateway non avviato');
}
async function stop(){
 if(!child)return;
 if(child.exitCode===null&&child.signalCode===null){const exited=once(child,'exit');child.kill();await exited;}
 child=undefined;
}
const request=(path,options={})=>fetch('http://127.0.0.1:8787'+path,{...options,signal:AbortSignal.timeout(6000)});
const post=(path,body,key)=>request(path,{method:'POST',headers:{'content-type':'application/json',...(key?{'idempotency-key':key}:{})},body:JSON.stringify(body)});
async function wait(id){for(let i=0;i<100;i++){const r=await request('/jobs/'+id);assert.equal(r.status,200);const job=await r.json();if(job.status==='done'||job.status==='failed')return job;await delay(50);}throw Error('Lavoro non terminato');}
try{
 fake.listen(11434,'127.0.0.1');await once(fake,'listening');
 await writeFile(join(dir,'jobs.v1.json'),'[]',{mode:0o600});
 await start({FORGIA_SQLITE_INITIALIZE:'1'});
 const providers=await (await request('/providers')).json();
 assert.equal((await request('/providers',{headers:{'X-Forgia-Require-Auth':'1'}})).status,403);
 assert.equal((await request('/jobs',{method:'POST',headers:{'X-Forgia-Require-Auth':'1','Content-Type':'application/json'},body:JSON.stringify({session,idea:'must not run',provider:'local'})})).status,403);
 assert.equal(calls,0);
 assert.equal(providers.providers.find(p=>p.id==='local').configured,true);
 assert.ok(providers.providers.filter(p=>p.id!=='local'&&p.id!=='llamacpp').every(p=>!p.configured));
 assert.equal((await request('/providers',{headers:{origin:'https://untrusted.invalid'}})).status,403);
 const body={session,idea:'Catalogo di prova',provider:'auto',cloudConsent:true};
 const first=await post('/jobs',body,'p1:p2');assert.equal(first.status,202);const {id}=await first.json();
 const lookup=(s,k)=>request('/jobs/receipt',{headers:{'X-Forgia-Session':s,'Idempotency-Key':k}});
 assert.deepEqual(await (await lookup(session,'p1:p2')).json(),{id});
 assert.equal((await lookup('00000000-0000-0000-0000-000000000002','p1:p2')).status,404);
 assert.equal((await lookup(session,'p1:p3')).status,404);
 assert.equal((await lookup(session,'bad')).status,400);
 assert.equal((await request('/jobs/receipt',{headers:{origin:'https://untrusted.invalid','X-Forgia-Session':session,'Idempotency-Key':'p1:p2'}})).status,403);
 assert.equal((await (await post('/jobs',body,'p1:p2')).json()).id,id);
 assert.equal((await post('/jobs',{...body,idea:'Diversa'},'p1:p2')).status,409);
 assert.equal((await post('/jobs',{...body,provider:'groq'},'request-2')).status,400);
 const job=await wait(id);assert.equal(job.status,'done');assert.deepEqual(job.result.spec,spec);assert.equal(calls,1);
 await stop();await start();
 assert.deepEqual(await wait(id),job);
 assert.deepEqual(await (await lookup(session,'p1:p2')).json(),{id});assert.equal(calls,1);
 assert.equal((await (await post('/jobs',body,'p1:p2')).json()).id,id);assert.equal(calls,1);
 const plan=await post('/plan',{...body,provider:'local'},'request-plan');assert.equal(plan.status,200);assert.deepEqual((await plan.json()).spec,spec);assert.equal(calls,2);
 assert.equal(await readFile(join(dir,'jobs.v1.json'),'utf8'),'[]');
 await stop();
 // Prepare cloud quota/cache from the preserved local gateway snapshot.
 const legacyBefore=await readFile(join(dir,'gateway.v1.json'),'utf8');
 await start({FORGIA_SQLITE_CLOUD_STATE:'1',FORGIA_SQLITE_CLOUD_INITIALIZE:'1'});
 assert.deepEqual(await wait(id),job);
 assert.ok((await (await request('/providers')).json()).providers.filter(p=>p.id!=='local'&&p.id!=='llamacpp').every(p=>!p.configured));
 assert.equal((await post('/jobs',{...body,provider:'groq'},'request-cloud')).status,400);
 assert.equal(await readFile(join(dir,'gateway.v1.json'),'utf8'),legacyBefore);
 await stop();await start({FORGIA_SQLITE_CLOUD_STATE:'1'});
 assert.deepEqual(await wait(id),job);
 assert.equal(calls,2);
 // Exercise the Superhandy CLI against the real Forgia main/durable queue.
 // Only the local Ollama transport is synthetic; no actual model inference.
 const cli=async(...args)=>JSON.parse((await promisify(execFile)(process.execPath,['--experimental-strip-types','scripts/superhandy.ts',...args],{cwd:root,env,timeout:15000})).stdout);
 const planPath=join(dir,'superhandy-plan.json'),reviewHash='a'.repeat(64);
 await writeFile(planPath,JSON.stringify({project:'demo',planner:'planner',reviewer:'reviewer',executors:['one'],tasks:[{id:'spec',depends:[],criterion:'Catalogo Superhandy'},{id:'next',depends:['spec'],criterion:'Altro catalogo'}]}),{mode:0o600});
 const baselineSha=await cli('init','integration',planPath);await cli('approve','integration','reviewer',baselineSha,reviewHash);
 assert.equal((await (await request('/providers')).json()).durableLocal,true);
 assert.equal((await (await request('/providers')).json()).durableModelPin,true);
 assert.equal((await post('/jobs',{...body,provider:'local',expectedModel:'wrong-model'},'wrong-pin')).status,409);
 assert.equal(calls,2);
 const grantPath=join(dir,'superhandy-grant.json');
 await writeFile(grantPath,JSON.stringify({version:1,baselineSha,actor:'one',taskId:'spec',provider:'local',model:'fixture-local',expiresAt:Date.now()+600000}),{mode:0o600});
 const sh=await cli('run-granted-local-spec','integration','one','spec','local',grantPath);assert.equal(sh.status,'submitted');
 assert.equal((await wait(sh.jobId)).status,'done');assert.equal(calls,3);
 const artifacts=join(dir,'superhandy','integration-artifacts'),names=await readdir(artifacts);
 const artifact=await readFile(join(artifacts,names.find(n=>n.endsWith('.result.json'))));
 assert.equal(createHash('sha256').update(artifact).digest('hex'),sh.evidence);
 assert.deepEqual(JSON.parse(artifact.toString()).spec,spec);
 assert.equal(await cli('claim','integration','one'),null);
 await cli('review','integration','reviewer','spec',sh.evidence,'accept',reviewHash);
 assert.equal((await cli('claim','integration','one')).task.id,'next');
 const afterBridge=calls;
 // Explicit rate-limit refusal: persist the same suspended job and honor
 // Retry-After across a real process restart. Never contact a cloud provider.
 rateLimited=true;
 const started=Date.now();
 const suspendedResponse=await post('/plan',{...body,idea:'Catalogo quota',provider:'local'},'request-quota');
 assert.equal(suspendedResponse.status,429);
 const suspended=await suspendedResponse.json();
 assert.ok(suspended.id);assert.ok(suspended.nextEligibleAt>=started+120000);
 const pending=await (await request('/jobs/'+suspended.id)).json();
 assert.equal(pending.status,'queued');assert.equal(pending.nextEligibleAt,suspended.nextEligibleAt);
 assert.equal(calls,afterBridge+1);
 await stop();await start({FORGIA_SQLITE_CLOUD_STATE:'1'});
 assert.deepEqual(await (await request('/jobs/'+suspended.id)).json(),pending);
 await delay(800);assert.equal(calls,afterBridge+1);
 const otherSuspendedResponse=await post('/plan',{...body,idea:'Altro catalogo quota',provider:'local'},'request-quota-other');
 assert.equal(otherSuspendedResponse.status,429);
 const otherSuspended=await otherSuspendedResponse.json();
 assert.notEqual(otherSuspended.id,suspended.id);assert.ok(otherSuspended.nextEligibleAt>=suspended.nextEligibleAt-1000);
 assert.equal(calls,afterBridge+1); // persisted provider-wide cooldown blocks a different job
 await stop();
 // Omitting the state opt-in after bootstrap must fail closed.
 child=spawn(process.execPath,['--experimental-strip-types','server/main.ts'],{cwd:root,env,stdio:'ignore'});
 const [missingOptIn]=await once(child,'exit');assert.notEqual(missingOptIn,0);child=undefined;
 // A normal legacy launch must refuse an existing cutover directory.
 child=spawn(process.execPath,['--experimental-strip-types','server/main.ts'],{cwd:root,env:{...env,FORGIA_SQLITE_LOCAL:'0'},stdio:'ignore'});
 const [code]=await once(child,'exit');assert.notEqual(code,0);child=undefined;
 // Guarded loopback smoke on separate throwaway database, same synthetic local provider.
 rateLimited=false;
 const authDir=join(dir,'auth-fixture'),authEnv={FORGIA_DATA_DIR:authDir};
 await mkdir(authDir,{mode:0o700});await writeFile(join(authDir,'jobs.v1.json'),'[]',{mode:0o600});
 await start({...authEnv,FORGIA_SQLITE_INITIALIZE:'1'});await stop();
 const token='a'.repeat(64),foreign='b'.repeat(64),other='00000000-0000-0000-0000-000000000002';
 const account=(id,value)=>({id,sha256:createHash('sha256').update(value).digest('hex'),expiresAt:new Date(Date.now()+600000).toISOString()});
 const accountPath=join(authDir,'sqlite-loopback','accounts.json');
 await writeFile(accountPath,JSON.stringify([account(session,token),account(other,foreign)]),{mode:0o600});
 const guarded={...authEnv,FORGIA_SQLITE_LOCAL_AUTH:'1'};
 const authRequest=(path,credential,options={})=>request(path,{...options,headers:{...options.headers,Authorization:'Bearer '+credential,'X-Forgia-Require-Auth':'1'}});
 const authPost=(payload,credential=token)=>authRequest('/jobs',credential,{method:'POST',headers:{'content-type':'application/json','idempotency-key':'p1:p2'},body:JSON.stringify(payload)});
 const authLookup=(credential=token,s=session)=>authRequest('/jobs/receipt',credential,{headers:{'X-Forgia-Session':s,'Idempotency-Key':'p1:p2'}});
 await start(guarded);
 assert.equal((await request('/providers')).status,401);
 assert.equal((await authRequest('/providers','c'.repeat(64))).status,401);
 const capabilities=await (await authRequest('/providers',token)).json();
 assert.equal(capabilities.durableAuthorizationRequired,true);assert.equal(capabilities.localDevelopmentOnly,true);assert.equal(capabilities.durableSession,session);
 assert.equal((await (await authRequest('/providers',foreign)).json()).durableSession,other);
 const preflight=await request('/providers',{method:'OPTIONS',headers:{origin:'http://127.0.0.1:8081','Access-Control-Request-Headers':'authorization,x-forgia-require-auth'}});
 assert.equal(preflight.status,204);assert.match(preflight.headers.get('access-control-allow-headers'),/X-Forgia-Require-Auth/i);
 assert.equal((await authPost({...body,session:other})).status,403);
 const beforeAuth=calls;
 const secured=await authPost({...body,provider:'local',expectedModel:'fixture-local'});
 assert.equal(secured.status,202);const {id:securedId}=await secured.json();
 assert.equal((await (await authPost({...body,provider:'local',expectedModel:'fixture-local'})).json()).id,securedId);
 assert.deepEqual(await (await authLookup()).json(),{id:securedId});
 assert.equal((await authLookup(foreign)).status,404);
 assert.equal((await authRequest('/jobs/'+securedId,foreign)).status,404);
 assert.equal((await request('/jobs/'+securedId)).status,401);
 let securedResult;
 for(let i=0;i<100;i++){
  const r=await authRequest('/jobs/'+securedId,token);assert.equal(r.status,200);
  const j=await r.json();if(j.status==='done'||j.status==='failed'){securedResult=j;break;}await delay(50);
 }
 assert.equal(securedResult?.status,'done');assert.deepEqual(securedResult.result.spec,spec);assert.equal(calls,beforeAuth+1);
 await stop();await start(guarded);
 assert.deepEqual(await (await authRequest('/jobs/'+securedId,token)).json(),securedResult);
 assert.deepEqual(await (await authLookup()).json(),{id:securedId});
 // Protected bridge: real CLI, HTTP and SQLite; synthetic local provider.
 const credentialPath=join(authDir,'bridge-credential.json');
 await writeFile(credentialPath,JSON.stringify({session,bearer:token}),{mode:0o600});
 const protectedCli=async(...args)=>JSON.parse((await promisify(execFile)(process.execPath,['--experimental-strip-types','scripts/superhandy.ts',...args],{cwd:root,env:{...env,...authEnv,FORGIA_SUPERHANDY_GATEWAY_CREDENTIAL_FILE:credentialPath},timeout:15000})).stdout);
 const protectedBaseline=await protectedCli('init','guarded',planPath);
 await protectedCli('approve','guarded','reviewer',protectedBaseline,reviewHash);
 const protectedGrant=join(authDir,'bridge-grant.json');
 await writeFile(protectedGrant,JSON.stringify({version:1,baselineSha:protectedBaseline,actor:'one',taskId:'spec',provider:'local',model:'fixture-local',expiresAt:Date.now()+600000}),{mode:0o600});
 const protectedResult=await protectedCli('run-granted-local-spec','guarded','one','spec','local',protectedGrant);
 assert.equal(protectedResult.status,'submitted');
 assert.equal(calls,beforeAuth+2);
 const protectedArtifacts=join(authDir,'superhandy','guarded-artifacts');
 for(const name of await readdir(protectedArtifacts)){const raw=await readFile(join(protectedArtifacts,name),'utf8');assert.ok(!raw.includes(token));}
 assert.equal((await authRequest('/jobs/'+protectedResult.jobId,foreign)).status,404);
 await protectedCli('review','guarded','reviewer','spec',protectedResult.evidence,'accept',reviewHash);
 await writeFile(accountPath,JSON.stringify([account(session,foreign)]));
 assert.equal((await authRequest('/jobs/'+securedId,token)).status,401);
 assert.equal((await authRequest('/jobs/'+securedId,foreign)).status,404);
 assert.equal((await authLookup(foreign)).status,404);
 assert.equal(calls,beforeAuth+2);
 await stop();
 child=spawn(process.execPath,['--experimental-strip-types','server/main.ts'],{cwd:root,env:{...env,...authEnv},stdio:'ignore'});
 const [downgrade]=await once(child,'exit');assert.notEqual(downgrade,0);child=undefined;
 console.log('D3/BSH11/A3/BSH12/UW4 PASS: HTTP, routing, Superhandy CLI, local adapter fixture, SQLite persistence, restart, legacy and authorization guards.');
}finally{await stop();if(fake.listening){fake.closeAllConnections();await new Promise(r=>fake.close(r));}await rm(dir,{recursive:true,force:true});}
