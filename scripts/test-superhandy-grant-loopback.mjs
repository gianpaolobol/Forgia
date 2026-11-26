// Standalone synthetic HTTP fixture. Run only with port 8787 free; no model or external service.
import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {mkdtempSync,mkdirSync,writeFileSync,rmSync,unlinkSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
const root=mkdtempSync(join(tmpdir(),'forgia-grant-smoke-')),data=join(root,'data');mkdirSync(data,{mode:0o700});
const plan=join(root,'plan.json'),grantPath=join(root,'grant.json'),h='a'.repeat(64);
const jobId='00000000-0000-4000-8000-000000000001';let posts=0,gets=0,done=false;
const meta={mode:'free-only',localDevelopmentOnly:true,durableLocal:true,durableModelPin:true,providers:[{id:'local',model:'qwen',configured:true}]};
const spec={name:'Demo',idea:'Catalogo A',kind:'catalog',quiz:false,items:[{name:'X',category:'Y',color:''}]};
const server=createServer(async(req,res)=>{
 try{
  const send=value=>{res.writeHead(200,{'content-type':'application/json'});res.end(JSON.stringify(value));};
  if(req.url==='/providers'&&req.method==='GET')return send(meta);
  if(req.url==='/jobs'&&req.method==='POST'){
   let body='';for await(const chunk of req){body+=chunk;if(body.length>4096)throw Error('body');}
   const parsed=JSON.parse(body);assert.equal(parsed.provider,'local');assert.equal(parsed.expectedModel,'qwen');assert.equal(parsed.cloudConsent,false);assert.equal(parsed.idea,'Catalogo A');posts++;return send({id:jobId});
  }
  if(req.url==='/jobs/'+jobId&&req.method==='GET'){
   gets++;return send(done?{status:'done',result:{spec,routing:{provider:'local',model:'qwen'}}}:{status:'queued',nextEligibleAt:Date.now()+60000});
  }
  res.writeHead(404);res.end();
 }catch{res.writeHead(500);res.end();}
});
const cli=async(...args)=>JSON.parse((await promisify(execFile)(process.execPath,['--experimental-strip-types','scripts/superhandy.ts',...args],{env:{PATH:process.env.PATH,SystemRoot:process.env.SystemRoot,FORGIA_DATA_DIR:data},encoding:'utf8',timeout:15000})).stdout);
try{
 await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(8787,'127.0.0.1',resolve);});
 writeFileSync(plan,JSON.stringify({project:'demo',planner:'planner',reviewer:'reviewer',executors:['one'],tasks:[{id:'a',depends:[],criterion:'Catalogo A'}]}),{mode:0o600});
 const baselineSha=await cli('init','demo',plan);await cli('approve','demo','reviewer',baselineSha,h);
 const grant=JSON.stringify({version:1,baselineSha,actor:'one',taskId:'a',provider:'local',model:'qwen',expiresAt:Date.now()+600000});
 await assert.rejects(cli('run-granted-local-spec','demo','one','a','local',grantPath));assert.equal(posts,0);
 writeFileSync(grantPath,grant,{mode:0o600});assert.equal((await cli('run-granted-local-spec','demo','one','a','local',grantPath)).status,'deferred');assert.equal(posts,1);
 done=true;const before=gets;await assert.rejects(cli('resume-local-spec','demo','one','a'));
 unlinkSync(grantPath);await assert.rejects(cli('resume-granted-local-spec','demo','one','a',grantPath));assert.equal(gets,before);
 writeFileSync(grantPath,grant,{mode:0o600});const out=await cli('resume-granted-local-spec','demo','one','a',grantPath);assert.equal(out.status,'submitted');assert.equal(posts,1);
 await cli('review','demo','reviewer','a',out.evidence,'accept',h);assert.equal((await cli('inspect','demo')).tasks[0].status,'accepted');
 console.log('G7 PASS: CLI processes, SQLite on disk, synthetic loopback HTTP, one POST, grant-bound GET recovery and separate fixture review.');
}finally{if(server.listening)await new Promise(resolve=>server.close(resolve));rmSync(root,{recursive:true,force:true});}
