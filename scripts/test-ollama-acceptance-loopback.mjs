// LA6/LA7: complete acceptance runner using a synthetic Ollama transport.
// Requires Node 24, clean checkout, free loopback ports 11434 and 8787.
import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {run} from './local-acceptance.mjs';
const model='forgia-ollama-fixture:latest';
const spec={name:'Catalogo prova Forgia',idea:'Catalogo di prova',kind:'catalog',quiz:false,items:[{name:'Alba',category:'A',color:''}]};
let calls=0,remote=false,rejected=0;
const server=createServer(async(req,res)=>{
 res.setHeader('content-type','application/json');
 try{
  if(req.headers.authorization!==undefined)throw Error('unexpected authorization');
  if(req.method==='GET'&&req.url==='/api/tags'){res.end(JSON.stringify({models:[{name:model,model,digest:'a'.repeat(64),size:123}]}));return;}
  let raw='';for await(const b of req){raw+=b;if(raw.length>100000)throw Error('oversize');}
  const body=JSON.parse(raw);
  if(body.model!==model)throw Error('wrong model');
  if(req.method==='POST'&&req.url==='/api/show'){res.end(JSON.stringify({model_info:{'general.architecture':'fixture'},...(remote?{remote_model:'remote',remote_host:'https://ollama.com'}:{})}));return;}
  if(req.method==='POST'&&req.url==='/api/chat'){
   calls++;
   if(body.stream!==false||body.format!=='json'||!body.messages?.some(m=>m.role==='user'&&m.content.includes('Catalogo prova Forgia')))throw Error('wrong payload');
   res.end(JSON.stringify({done:true,message:{content:JSON.stringify(spec)}}));return;
  }
  throw Error('unexpected request');
 }catch{rejected++;res.writeHead(400);res.end('{}');}
});
const args=['--confirm-local-runtime','--confirm-ollama-no-cloud','--model',model];
try{
 await new Promise((ok,fail)=>{server.once('error',fail);server.listen(11434,'127.0.0.1',ok);});
 const success=await run(args);
 assert.equal(success.pass,true,JSON.stringify(success));
 assert.equal(success.scope,'operator-confirmed-loopback-ollama-no-cloud-protected-sqlite');
 assert.deepEqual(success.checks,{runtimeAliasAdvertised:true,protectedLocalOnly:true,uncachedPinnedCatalog:true,sameReceiptAfterRestart:true,revocation:true,checkoutUnchanged:true});
 assert.equal(success.dispatchMayHaveOccurred,true);assert.equal(success.reconciliationRequired,false);
 assert.equal(calls,1);assert.equal(rejected,0);
 console.log('LA6 PASS: Ollama acceptance runner, gateway/SQLite, one synthetic inference, receipt recovery and revocation.');
 remote=true;
 const failure=await run(args);
 assert.equal(failure.pass,false,JSON.stringify(failure));assert.equal(failure.failedStage,'local-runtime');
 assert.equal(failure.dispatchMayHaveOccurred,false);assert.equal(calls,1);assert.equal(rejected,0);
 console.log('LA7 PASS: remote metadata rejected before dispatch.');
}finally{
 if(server.listening){server.closeAllConnections();await new Promise(ok=>server.close(ok));}
}
