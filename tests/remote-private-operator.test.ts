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
  const store={status:()=>({node:'pc',online:false,lastSeenAt:null})};
  for(const config of [
    {host:'127.0.0.1',login,port:0},{host:'workstation.example.ts.net.evil.invalid',login,port:0},
    {host,login:'*',port:0},{host,login,port:8787},{host,login,port:-1},
  ])await assert.rejects(listenPrivateOperator(store,config),/Invalid private operator configuration/);
});
