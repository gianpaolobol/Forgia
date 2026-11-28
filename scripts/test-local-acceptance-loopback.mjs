// LA4/LA5: exercise the actual operator runner, not a model inference.
// Dedicated loopback fixture; no cloud key, download or external network.
import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {run} from './local-acceptance.mjs';
const model='forgia-llamacpp-fixture';
const spec={name:'Catalogo prova Forgia',idea:'Catalogo di prova',kind:'catalog',quiz:false,items:[{name:'Alba',category:'A',color:''}]};
let calls=0,invalid=false,unexpected=0;
const fake=createServer(async(req,res)=>{
 res.setHeader('content-type','application/json');
 if(req.method==='GET'&&req.url==='/health'){res.end(JSON.stringify({status:'ok'}));return;}
 if(req.method==='GET'&&req.url==='/v1/models'){res.end(JSON.stringify({data:[{id:model}]}));return;}
 if(req.method!=='POST'||req.url!=='/v1/chat/completions'){unexpected++;res.writeHead(404);res.end('{}');return;}
 calls++;
 try{
  let raw='';for await(const chunk of req){raw+=chunk;if(raw.length>100000){res.writeHead(413);res.end('{}');return;}}
  const body=JSON.parse(raw);
  if(body.model!==model||(body.stream!==undefined&&body.stream!==false)||req.headers.authorization!==undefined||
     !body.messages?.some(m=>m.role==='user'&&m.content.includes('Catalogo prova Forgia'))||
     body.response_format?.type!=='json_object'||body.response_format?.schema?.type!=='object'){unexpected++;res.writeHead(400);res.end('{}');return;}
  res.end(JSON.stringify({choices:[{finish_reason:'stop',message:{content:invalid?'not-json':JSON.stringify(spec)}}]}));
 }catch{unexpected++;res.writeHead(400);res.end('{}');}
});
const args=['--confirm-local-runtime','--model',model];
try{
 await new Promise((resolve,reject)=>{fake.once('error',reject);fake.listen(8080,'127.0.0.1',resolve);});
 const success=await run(args);
 assert.equal(success.pass,true,JSON.stringify({...success,fixtureCalls:calls,fixtureRejected:unexpected}));
 assert.deepEqual(success.checks,{runtimeAliasAdvertised:true,protectedLocalOnly:true,uncachedPinnedCatalog:true,sameReceiptAfterRestart:true,revocation:true,checkoutUnchanged:true});
 assert.equal(success.dispatchMayHaveOccurred,true);
 assert.equal(success.reconciliationRequired,false);
 assert.equal(calls,1);assert.equal(unexpected,0);
 console.log('LA4 PASS: acceptance runner, real HTTP/SQLite, one synthetic local adapter call, recovery and revocation.');
 invalid=true;
 const failure=await run(args);
 assert.equal(failure.pass,false,JSON.stringify(failure));
 assert.equal(failure.failedStage,'inference');
 assert.equal(failure.inferenceCheckpoint,'job-state');assert.equal(failure.dispatchMayHaveOccurred,true);
 assert.equal(failure.checks.uncachedPinnedCatalog,undefined);
 assert.equal(calls,2);assert.equal(unexpected,0);
 console.log('LA5 PASS: invalid synthetic model response rejected, no retry or false success.');
}finally{
 if(fake.listening){fake.closeAllConnections();await new Promise(resolve=>fake.close(resolve));}
}
