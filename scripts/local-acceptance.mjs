// Opt-in acceptance against an operator-confirmed, already running llama.cpp.
// Local by default. The separate cloud entrypoint requires explicit synthetic-data and quota consent.
// Never start/download a model or touch an existing data directory.
import assert from 'node:assert/strict';
import {spawn,spawnSync} from 'node:child_process';
import {createHash,randomBytes,randomUUID} from 'node:crypto';
import {createServer} from 'node:net';
import {mkdtemp,writeFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {setTimeout as delay} from 'node:timers/promises';

const root=fileURLToPath(new URL('../',import.meta.url));
const name='Catalogo prova Forgia', item='Alba';
export function parseArgs(args){
 if(args.length!==3||args[0]!=='--confirm-local-runtime'||args[1]!=='--model'||!/^[a-zA-Z0-9_.:-]{1,150}$/.test(args[2]))throw Error('explicit-local-runtime-and-alias-required');
 return args[2];
}
export function acceptsResult(job,model,provider='llamacpp'){
 const r=job?.result,s=r?.spec;
 return job?.status==='done'&&r?.cached===false&&r?.routing?.provider===provider&&r?.routing?.model===model&&
  s?.kind==='catalog'&&s?.name===name&&s?.quiz===false&&Array.isArray(s.items)&&s.items.length===1&&
  s.items[0]?.name===item&&s.items[0]?.category==='A'&&s.items[0]?.color==='';
}
const git=args=>spawnSync('git',args,{cwd:root,encoding:'utf8',timeout:15000,windowsHide:true});
function cleanHead(){
 const head=git(['rev-parse','HEAD']),clean=git(['status','--porcelain','--untracked-files=normal']);
 if(head.status!==0||clean.status!==0||!/^[a-f0-9]{40}$/.test(head.stdout?.trim()??'')||clean.stdout?.trim()!=='')throw Error('clean-checkout-required');
 return head.stdout.trim();
}
async function freeGatewayPort(){
 const server=createServer();
 await new Promise((ok,fail)=>{server.once('error',fail);server.listen(8787,'127.0.0.1',ok);});
 await new Promise((ok,fail)=>server.close(e=>e?fail(e):ok()));
}
async function json(url,options={}){
 const response=await fetch(url,{...options,redirect:'error',signal:AbortSignal.timeout(5000)});
 return {status:response.status,data:await response.json()};
}
export function parseCloudArgs(args){
 if(args.length!==4||args[0]!=='--confirm-free-quota'||args[1]!=='--consent-synthetic-cloud'||args[2]!=='--model'||typeof args[3]!=='string'||args[3].length>150||!(/^[a-z0-9._-]+\/[a-z0-9._-]+:free$/i.test(args[3]))||!args[3].endsWith(':free'))throw Error('explicit-free-quota-and-synthetic-cloud-consent-required');
 return args[3];
}
export function run(args){return runAcceptance(args,false);}
export function runCloud(args){return runAcceptance(args,true);}
async function runAcceptance(args,cloud){
 const checks={};
 let stage='preflight',dir,child,sha,model;
 const started=Date.now();
 const stop=async()=>{
  if(!child)return;
  const p=child;
  if(p.exitCode===null&&p.signalCode===null){
   p.kill();
   for(let i=0;i<100&&p.exitCode===null&&p.signalCode===null;i++)await delay(50);
   if(p.exitCode===null&&p.signalCode===null){
    p.kill('SIGKILL');
    for(let i=0;i<100&&p.exitCode===null&&p.signalCode===null;i++)await delay(50);
   }
   if(p.exitCode===null&&p.signalCode===null)throw Error('gateway-stop-failed');
  }
  child=undefined;
 };
 let pass=false,dispatchMayHaveOccurred=false;
 try{
  model=cloud?parseCloudArgs(args):parseArgs(args);
  const provider=cloud?'openrouter':'llamacpp';
  const apiKey=cloud?process.env.OPENROUTER_API_KEY:undefined;
  if(cloud&&(!apiKey?.trim()||/\s/.test(apiKey)))throw Error('private-server-key-required');
  const day=new Date().toISOString().slice(0,10);
  if(cloud&&new Date(Date.now()+600000).toISOString().slice(0,10)!==day)throw Error('avoid-utc-quota-boundary');
  assert.equal(process.versions.node.split('.')[0],'24');
  sha=cleanHead();
  await freeGatewayPort();
  if(!cloud){
  stage='local-runtime';
  const health=await fetch('http://127.0.0.1:8080/health',{signal:AbortSignal.timeout(5000),redirect:'error'});
  assert.equal(health.status,200);await health.body?.cancel();
  const models=await json('http://127.0.0.1:8080/v1/models');
  assert.equal(models.status,200);
  assert.ok(Array.isArray(models.data?.data)&&models.data.data.some(m=>m.id===model));
  checks.runtimeAliasAdvertised=true;
  }
  stage='isolated-migration';
  dir=await mkdtemp(join(tmpdir(),'forgia-local-acceptance-'));
  const session=randomUUID(),token=randomBytes(32).toString('hex');
  const env={};
  for(const key of ['PATH','SystemRoot','WINDIR','TEMP','TMP'])if(process.env[key])env[key]=process.env[key];
  Object.assign(env,{FORGIA_DATA_DIR:dir,FORGIA_SQLITE_LOCAL:'1',...(!cloud?{LLAMACPP_MODEL:model}:{})});
  await writeFile(join(dir,'jobs.v1.json'),'[]',{mode:0o600});
  // Fresh synthetic fixture, never replace production quota. Reserve all but one daily slot.
  if(cloud)await writeFile(join(dir,'gateway.v1.json'),JSON.stringify({version:1,day,counts:{openrouter:19},cache:{},pilotCache:{}}),{mode:0o600});
  const start=async extra=>{
   await freeGatewayPort();
   child=spawn(process.execPath,['--experimental-strip-types','server/main.ts'],{cwd:root,env:{...env,...extra},stdio:['ignore','pipe','ignore'],windowsHide:true});
   let output='',error=false;
   child.on('error',()=>{error=true;});
   child.stdout.on('data',b=>{output=(output+b.toString()).slice(-8192);});
   for(let i=0;i<200;i++){
    if(error||child.exitCode!==null||child.signalCode!==null)throw Error('gateway-start-failed');
    if(output.includes('Gateway gratuito di sviluppo:'))return;
    await delay(50);
   }
   throw Error('gateway-start-timeout');
  };
  const base='http://127.0.0.1:8787';
  await start({FORGIA_SQLITE_INITIALIZE:'1'});
  await stop();
  const accounts=join(dir,'sqlite-loopback','accounts.json');
  await writeFile(accounts,JSON.stringify([{id:session,sha256:createHash('sha256').update(token).digest('hex'),expiresAt:new Date(Date.now()+600000).toISOString()}]),{mode:0o600});
  const guarded={FORGIA_SQLITE_LOCAL_AUTH:'1',...(cloud?{FORGIA_SQLITE_CLOUD_STATE:'1'}:{})};
  if(cloud){await start({...guarded,FORGIA_SQLITE_CLOUD_INITIALIZE:'1'});await stop();}
  const enabled=cloud?{...guarded,FORGIA_SQLITE_OPENROUTER_SESSION:session,OPENROUTER_MODEL:model,OPENROUTER_API_KEY:apiKey}:guarded;
  await start(enabled);
  const headers={Authorization:'Bearer '+token,'X-Forgia-Require-Auth':'1'};
  const request=(path,opts={})=>json(base+path,{...opts,headers:{...headers,...opts.headers}});
  assert.equal((await json(base+'/providers')).status,401);
  const cap=await request('/providers');
  assert.equal(cap.status,200);
  assert.equal(cap.data.durableAuthorizationRequired,true);
  assert.equal(cap.data.durableModelPin,true);
  assert.equal(cap.data.durableSession,session);
  if(cloud){
   assert.deepEqual(cap.data.durableCloudExplicit,{provider,model});
   assert.ok(cap.data.providers.every(p=>!p.configured));
   checks.protectedExplicitCloud=true;
  }else{
   assert.ok(cap.data.providers.some(p=>p.id==='llamacpp'&&p.model===model&&p.configured));
   assert.ok(cap.data.providers.filter(p=>p.id!=='llamacpp').every(p=>!p.configured));
   checks.protectedLocalOnly=true;
  }
  stage='inference';
  const key='acceptance:p1', payload={session,provider,expectedModel:model,cloudConsent:cloud,idea:'Crea un catalogo offline di nome "'+name+'", senza quiz, con una sola scheda "'+item+'", categoria A, colore non indicato (stringa vuota).'};
  const post=()=>request('/jobs',{method:'POST',headers:{'Content-Type':'application/json','Idempotency-Key':key},body:JSON.stringify(payload)});
  if(cloud)assert.equal(new Date(Date.now()+120000).toISOString().slice(0,10),day);
  // Mark before sending: a lost response must not imply that no inference occurred.
  dispatchMayHaveOccurred=true;
  const first=await post();
  assert.equal(first.status,202);
  const id=first.data?.id;
  assert.match(id,/^[a-f0-9-]{36}$/);
  const read=()=>request('/jobs/'+id);
  const receipt=()=>request('/jobs/receipt',{headers:{'X-Forgia-Session':session,'Idempotency-Key':key}});
  let job;
  const deadline=Date.now()+65000;
  while(Date.now()<deadline){
   const current=await read();
   assert.equal(current.status,200);
   if(current.data.status==='done'){job=current.data;break;}
   assert.ok(['queued','running'].includes(current.data.status));
   assert.ok(!(current.data.nextEligibleAt>Date.now()));
   await delay(300);
  }
  assert.ok(acceptsResult(job,model,provider));
  if(cloud)assert.equal(job.result.requestsUsed,20);
  checks.uncachedPinnedCatalog=true;
  stage='restart-receipt';
  assert.deepEqual((await receipt()).data,{id});
  await stop();
  // For cloud, restart with no key or cloud policy: recovery must not dispatch.
  await start(guarded);
  assert.deepEqual((await read()).data,job);
  const recovered=await receipt();
  assert.equal(recovered.status,200);assert.deepEqual(recovered.data,{id});
  if(cloud){
   assert.equal((await request('/providers')).data.durableCloudExplicit,undefined);
   assert.equal((await post()).status,400);
   // Verify persisted quota/cache after shutdown, without another inference or even a new job.
   await stop();
   const {DatabaseSync}=await import('node:sqlite');
   const db=new DatabaseSync(join(dir,'sqlite-loopback','cloud.sqlite'),{readOnly:true});
   try{
    const row=db.prepare("SELECT day,used FROM forgia_quota_v1 WHERE provider='openrouter'").get();
    assert.equal(row.day,day);assert.equal(row.used,20);
    const cache=db.prepare('SELECT value FROM forgia_cloud_cache_v1').all();
    assert.equal(cache.length,1);assert.deepEqual(JSON.parse(cache[0].value),job.result.spec);
   }finally{db.close();}
   checks.quotaAndCachePersisted=true;
   await start(guarded);
  }else{
   const duplicate=await post();
   assert.equal(duplicate.status,202);assert.equal(duplicate.data.id,id);
  }
  assert.deepEqual((await read()).data,job);
  checks.sameReceiptAfterRestart=true;
  stage='revocation';
  await writeFile(accounts,'[]',{mode:0o600});
  assert.equal((await read()).status,401);
  assert.equal((await receipt()).status,401);
  assert.equal((await post()).status,401);
  checks.revocation=true;
  stage='checkout';
  assert.equal(cleanHead(),sha);
  checks.checkoutUnchanged=true;
  pass=true;
 }catch{
  // Report only the bounded stage, never raw exception/model output/credential.
 }finally{
  try{await stop();if(dir)await rm(dir,{recursive:true,force:true});}
  catch{pass=false;stage='cleanup';}
 }
 return {pass,sha,model,node:process.versions.node,elapsedMs:Date.now()-started,scope:cloud?'operator-confirmed-openrouter-free-protected-sqlite':'operator-confirmed-loopback-llamacpp-protected-sqlite',dispatchMayHaveOccurred,reconciliationRequired:cloud&&dispatchMayHaveOccurred,checks,...(!pass?{failedStage:stage}:{})};
}
if(process.argv[1]&&import.meta.url===pathToFileURL(resolve(process.argv[1])).href){
 const result=await run(process.argv.slice(2));
 console.log(JSON.stringify(result,null,2));process.exitCode=result.pass?0:1;
}
