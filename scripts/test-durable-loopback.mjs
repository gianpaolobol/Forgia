// Dedicated integration test: requires free loopback ports 8787 and 11434.
// No user data, model downloads, real provider calls, or inherited API keys.
import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {spawn} from 'node:child_process';
import {once} from 'node:events';
import {mkdtemp,rm,writeFile,readFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {fileURLToPath} from 'node:url';
const root=fileURLToPath(new URL('../',import.meta.url));
const dir=await mkdtemp(join(tmpdir(),'forgia-http-'));
const session='00000000-0000-0000-0000-000000000001';
const spec={name:'Catalogo',idea:'Catalogo di prova',kind:'catalog',quiz:false,items:[{name:'A',category:'A',color:''}]};
let calls=0,child;
const fake=createServer(async(req,res)=>{
 for await(const _ of req) { /* consume synthetic request */ }
 calls++;
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
 assert.equal(providers.providers.find(p=>p.id==='local').configured,true);
 assert.ok(providers.providers.filter(p=>p.id!=='local'&&p.id!=='llamacpp').every(p=>!p.configured));
 assert.equal((await request('/providers',{headers:{origin:'https://untrusted.invalid'}})).status,403);
 const body={session,idea:'Catalogo di prova',provider:'auto',cloudConsent:true};
 const first=await post('/jobs',body,'request-1');assert.equal(first.status,202);const {id}=await first.json();
 assert.equal((await (await post('/jobs',body,'request-1')).json()).id,id);
 assert.equal((await post('/jobs',{...body,idea:'Diversa'},'request-1')).status,409);
 assert.equal((await post('/jobs',{...body,provider:'groq'},'request-2')).status,400);
 const job=await wait(id);assert.equal(job.status,'done');assert.deepEqual(job.result.spec,spec);assert.equal(calls,1);
 await stop();await start();
 assert.deepEqual(await wait(id),job);
 assert.equal((await (await post('/jobs',body,'request-1')).json()).id,id);assert.equal(calls,1);
 const plan=await post('/plan',{...body,provider:'local'},'request-plan');assert.equal(plan.status,200);assert.deepEqual((await plan.json()).spec,spec);assert.equal(calls,2);
 assert.equal(await readFile(join(dir,'jobs.v1.json'),'utf8'),'[]');
 await stop();
 // A normal legacy launch must refuse an existing cutover directory.
 child=spawn(process.execPath,['--experimental-strip-types','server/main.ts'],{cwd:root,env:{...env,FORGIA_SQLITE_LOCAL:'0'},stdio:'ignore'});
 const [code]=await once(child,'exit');assert.notEqual(code,0);child=undefined;
 console.log('D3 PASS: HTTP, routing, local adapter fixture, SQLite persistence, restart, legacy guard.');
}finally{await stop();if(fake.listening){fake.closeAllConnections();await new Promise(r=>fake.close(r));}await rm(dir,{recursive:true,force:true});}
