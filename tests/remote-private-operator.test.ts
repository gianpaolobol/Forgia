import {test} from 'node:test';
import assert from 'node:assert/strict';
import {request,type Server} from 'node:http';
import {DatabaseSync} from 'node:sqlite';
import {RemoteNodeStatus} from '../server/remoteNodeStatus.ts';
import {listenPrivateOperator} from '../server/remotePrivateOperator.ts';

const host='workstation.example.ts.net',login='operator@example.invalid';
const standard=['Host',host,'Tailscale-User-Login',login,'X-Forwarded-Proto','https'];
function get(server:Server,path:string,headers:string[],method='GET'){
  const address=server.address();
  assert.ok(address&&typeof address!=='string');
  return new Promise<{status:number;body:string;cache:string|undefined}>((resolve,reject)=>{
    const req=request({hostname:'127.0.0.1',port:address.port,path,method,headers,agent:false},res=>{
      let body='';res.setEncoding('utf8');res.on('data',chunk=>body+=chunk);
      res.on('end',()=>resolve({status:res.statusCode??0,body,cache:res.headers['cache-control']}));
      res.on('error',reject);
    });req.on('error',reject);req.end();
  });
}
async function fixture(){
  let now=1000;
  const db=new DatabaseSync(':memory:');
  const store=new RemoteNodeStatus(db,()=>now);
  store.register('pc');store.register('other');
  const node=store.issue('pc','node',5000),op=store.issue('pc','operator',5000);
  const other=store.issue('other','operator',5000);
  store.heartbeat(node.token,1);
  const server=await listenPrivateOperator(store,{host,login,port:0});
  const auth=(token:string)=>[...standard,'Authorization','Bearer '+token];
  return {server,store,node,op,other,auth,advance:(v:number)=>{now=v;},
    close:async()=>{await new Promise<void>((resolve,reject)=>server.close(error=>error?reject(error):resolve()));db.close();}};
}
test('RC41 private operator requires exact proxy identity, HTTPS and scoped grant',async()=>{
  const f=await fixture();
  try{
    const a=f.server.address();assert.ok(a&&typeof a!=='string');assert.equal(a.address,'127.0.0.1');
    const res=await get(f.server,'/v1/status',f.auth(f.op.token));
    assert.equal(res.status,200);assert.equal(res.cache,'no-store');
    assert.deepEqual(JSON.parse(res.body),{node:'pc',online:true,lastSeenAt:1000});
    const other=await get(f.server,'/v1/status',f.auth(f.other.token));
    assert.deepEqual(JSON.parse(other.body),{node:'other',online:false,lastSeenAt:null});
    assert.equal((await get(f.server,'/v1/status',standard)).status,401);
    assert.equal((await get(f.server,'/v1/status',f.auth(f.node.token))).status,401);
  }finally{await f.close();}
});
test('RC42 rejects wrong, absent and duplicate proxy identities, insecure protocol and host',async()=>{
  const f=await fixture();
  try{
    const bearer=['Authorization','Bearer '+f.op.token];
    for(const h of [
      ['Host',host,'X-Forwarded-Proto','https'],
      ['Host',host,'Tailscale-User-Login','other@example.invalid','X-Forwarded-Proto','https'],
      [...standard,'Tailscale-User-Login',login],
      ['Host',host,'Tailscale-User-Login',login,'X-Forwarded-Proto','http'],
      ['Host','other.example.ts.net','Tailscale-User-Login',login,'X-Forwarded-Proto','https'],
      ['Host',host,'Tailscale-User-Login',login],
    ]){
      const res=await get(f.server,'/v1/status',[...h,...bearer]);
      assert.equal(res.status,403);assert.equal(res.body,'{"error":"forbidden"}');
    }
  }finally{await f.close();}
});
test('RC43 private UI denies cross-origin access and never exposes mutation or gateway routes',async()=>{
  const f=await fixture();
  try{
    const auth=f.auth(f.op.token);
    assert.equal((await get(f.server,'/operator',standard)).status,200);
    assert.match((await get(f.server,'/operator',standard)).body,/stato privato/);
    assert.equal((await get(f.server,'/operator',['Host',host])).status,403);
    assert.equal((await get(f.server,'/v1/status',[...auth,'Origin','https://evil.invalid'])).status,403);
    assert.equal((await get(f.server,'/v1/status',[...auth,'Sec-Fetch-Site','same-site'])).status,403);
    assert.equal((await get(f.server,'/v1/status',[...auth,'Origin','https://'+host,'Sec-Fetch-Site','same-origin'])).status,200);
    assert.equal((await get(f.server,'/v1/heartbeat',auth,'POST')).status,400);
    for(const path of ['/v1/heartbeat','/v1/status?token=ignored','/v1/jobs','/api','/admin','/']){
      assert.equal((await get(f.server,path,auth)).status,404);
    }
  }finally{await f.close();}
});
test('RC44 live revocation, expiry and duplicate bearer fail closed',async()=>{
  const f=await fixture();
  try{
    assert.equal((await get(f.server,'/v1/status',[...f.auth(f.op.token),'Authorization','Bearer '+f.op.token])).status,401);
    f.store.revoke(f.op.id);
    assert.equal((await get(f.server,'/v1/status',f.auth(f.op.token))).status,401);
    f.advance(6000);
    assert.equal((await get(f.server,'/v1/status',f.auth(f.other.token))).status,401);
  }finally{await f.close();}
});
test('RC45 rejects unsafe configuration before binding',async()=>{
  const store={status:()=>({node:'pc',online:false,lastSeenAt:null}),requestSnapshot:()=>{throw Error('unused');},readSnapshot:()=>{throw Error('unused');}};
  for(const config of [
    {host:'127.0.0.1',login,port:0},{host:'workstation.example.ts.net.evil.invalid',login,port:0},
    {host,login:'*',port:0},{host,login,port:8787},{host,login,port:-1},
  ])await assert.rejects(listenPrivateOperator(store,config),/Invalid private operator configuration/);
});

const snapshotKey='snapshot_private_0001';
const postHeaders=['Origin','https://'+host,'Sec-Fetch-Site','same-origin','Idempotency-Key',snapshotKey,'Content-Length','0'];
test('RC51 private diagnostic receipt is idempotent and completed by authorized heartbeat',async()=>{
 const f=await fixture();
 try{
   const headers=[...f.auth(f.op.token),...postHeaders];
   const first=await get(f.server,'/v1/snapshots',headers,'POST');
   assert.equal(first.status,202);assert.equal(first.cache,'no-store');
   const id=JSON.parse(first.body).id;
   assert.deepEqual(await get(f.server,'/v1/snapshots',headers,'POST'),first);
   const path='/v1/snapshots/'+id;
   assert.equal(JSON.parse((await get(f.server,path,f.auth(f.op.token))).body).state,'queued');
   f.advance(2000);f.store.heartbeat(f.node.token,2);
   const receipt=await get(f.server,path,f.auth(f.op.token));
   assert.equal(receipt.status,200);assert.deepEqual(JSON.parse(receipt.body),{id,node:'pc',state:'done',createdAt:1000,completedAt:2000,sequence:2});
 }finally{await f.close();}
});
test('RC52 diagnostic submission requires origin, fetch site, idempotency and empty body',async()=>{
 const f=await fixture();
 try{
   const auth=f.auth(f.op.token);
   for(const extra of [[],postHeaders.slice(2),postHeaders.slice(0,2),[...postHeaders,'Idempotency-Key',snapshotKey],['Origin','https://'+host,'Sec-Fetch-Site','same-origin','Idempotency-Key','bad'],['Origin','https://'+host,'Sec-Fetch-Site','same-origin','Idempotency-Key',snapshotKey,'Content-Length','1'],['Origin','https://'+host,'Sec-Fetch-Site','same-origin','Idempotency-Key',snapshotKey,'Transfer-Encoding','chunked']]){
     const r=await get(f.server,'/v1/snapshots',[...auth,...extra],'POST');
     assert.equal(r.status,400);
   }
   assert.equal((await get(f.server,'/v1/snapshots',[...auth,'Origin','https://evil.invalid','Sec-Fetch-Site','same-origin','Idempotency-Key',snapshotKey],'POST')).status,403);
   assert.equal((await get(f.server,'/v1/snapshots',auth)).status,404);
   assert.equal((await get(f.server,'/v1/snapshots?payload=x',[...auth,...postHeaders],'POST')).status,400);
 }finally{await f.close();}
});
test('RC53 diagnostic receipt rejects other grants and live revocation',async()=>{
 const f=await fixture();
 try{
   const first=await get(f.server,'/v1/snapshots',[...f.auth(f.op.token),...postHeaders],'POST');
   assert.equal(first.status,202);
   const path='/v1/snapshots/'+JSON.parse(first.body).id;
   const second=f.store.issue('pc','operator',5000);
   for(const token of [second.token,f.other.token,f.node.token]){
     assert.equal((await get(f.server,path,f.auth(token))).status,401);
   }
   assert.equal((await get(f.server,'/v1/snapshots',[...f.auth(f.node.token),...postHeaders],'POST')).status,401);
   f.store.revoke(f.op.id);
   assert.equal((await get(f.server,path,f.auth(f.op.token))).status,401);
   assert.equal((await get(f.server,'/v1/snapshots',[...f.auth(f.op.token),...postHeaders],'POST')).status,401);
 }finally{await f.close();}
});
test('RC54 private UI exposes diagnostic controls without embedding credentials or enabling gateway',async()=>{
 const f=await fixture();
 try{
   const page=await get(f.server,'/operator',standard),script=await get(f.server,'/operator.js',standard);
   assert.equal(page.status,200);assert.match(page.body,/snapshot-send/);assert.match(page.body,/snapshot-read/);
   assert.equal(script.status,200);assert.match(script.body,/Idempotency-Key/);assert.match(script.body,/redirect:'error'/);
   assert.ok(!page.body.includes(f.op.token)&&!script.body.includes(f.op.token));
   assert.doesNotMatch(script.body,/localStorage|sessionStorage/);
   assert.equal((await get(f.server,'/v1/jobs',[...f.auth(f.op.token),...postHeaders],'POST')).status,400);
 }finally{await f.close();}
});
