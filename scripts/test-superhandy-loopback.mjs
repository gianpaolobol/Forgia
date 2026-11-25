// Separate smoke test: real CLI processes, SQLite and loopback HTTP;
 // the gateway responses are synthetic. No model or external network.
import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {mkdtemp,rm,writeFile,readdir,readFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {createHash} from 'node:crypto';
const root=fileURLToPath(new URL('../',import.meta.url)),dir=await mkdtemp(join(tmpdir(),'forgia-sh-http-'));
const jobId='00000000-0000-4000-8000-000000000001',h='a'.repeat(64);
const plan={project:'demo',planner:'planner',reviewer:'reviewer',executors:['one'],tasks:[{id:'spec',depends:[],criterion:'Catalogo di prova'},{id:'next',depends:['spec'],criterion:'Altro catalogo'}]};
const spec={name:'Catalogo',idea:'Catalogo di prova',kind:'catalog',quiz:false,items:[{name:'A',category:'A',color:''}]};
let posts=0,done=false,failure;
const fake=createServer(async(req,res)=>{
 try{
  res.setHeader('content-type','application/json');
  if(req.method==='GET'&&req.url==='/providers')return res.end(JSON.stringify({mode:'free-only',localDevelopmentOnly:true,durableLocal:true,providers:[{id:'local',model:'fixture-local',configured:true}]}));
  if(req.method==='POST'&&req.url==='/jobs'){
   posts++;const chunks=[];for await(const chunk of req)chunks.push(chunk);
   const body=JSON.parse(Buffer.concat(chunks).toString('utf8'));
   assert.equal(body.idea,'Catalogo di prova');assert.equal(body.provider,'local');assert.equal(body.cloudConsent,false);assert.ok(req.headers['idempotency-key'].startsWith('sh:'));
   res.writeHead(202);return res.end(JSON.stringify({id:jobId}));
  }
  if(req.method==='GET'&&req.url==='/jobs/'+jobId)return res.end(JSON.stringify(done?{status:'done',result:{spec,routing:{provider:'local',model:'fixture-local'}}}:{status:'queued',nextEligibleAt:Date.now()+60000}));
  throw Error('Unexpected request');
 }catch(e){failure=e;res.writeHead(500);res.end('{}');}
});
const run=async(...args)=>JSON.parse((await promisify(execFile)(process.execPath,['--experimental-strip-types','scripts/superhandy.ts',...args],{cwd:root,env:{PATH:process.env.PATH,SystemRoot:process.env.SystemRoot,FORGIA_DATA_DIR:dir},timeout:15000})).stdout);
try{
 await new Promise((resolve,reject)=>{fake.once('error',reject);fake.listen(8787,'127.0.0.1',resolve);});
 const p=join(dir,'plan.json');await writeFile(p,JSON.stringify(plan),{mode:0o600});
 const sha=await run('init','demo',p);await run('approve','demo','reviewer',sha,h);
 const first=await run('run-local-spec','demo','one','spec','local');assert.equal(first.status,'deferred');assert.equal(first.jobId,jobId);
 done=true;const resumed=await run('resume-local-spec','demo','one','spec');assert.equal(resumed.status,'submitted');assert.equal(posts,1);
 const state=await run('inspect','demo');assert.equal(state.tasks.find(t=>t.id==='spec').status,'submitted');assert.equal(state.tasks.find(t=>t.id==='next').status,'queued');
 const artifacts=join(dir,'superhandy','demo-artifacts'),files=await readdir(artifacts),body=await readFile(join(artifacts,files.find(f=>f.endsWith('.result.json'))));
 assert.equal(createHash('sha256').update(body).digest('hex'),resumed.evidence);assert.deepEqual(JSON.parse(body.toString()).spec,spec);
 assert.equal(await run('claim','demo','one'),null);await run('review','demo','reviewer','spec',resumed.evidence,'accept',h);assert.equal((await run('claim','demo','one')).task.id,'next');
 assert.ifError(failure);console.log('BSH10 PASS: CLI processes, real loopback HTTP, SQLite, read-only resume, artifact hash and review gate; synthetic gateway.');
}finally{if(fake.listening){fake.closeAllConnections();await new Promise(r=>fake.close(r));}await rm(dir,{recursive:true,force:true});}
