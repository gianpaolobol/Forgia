import {test} from 'node:test';
import assert from 'node:assert/strict';
import {randomBytes} from 'node:crypto';
import {existsSync,mkdirSync,mkdtempSync,realpathSync,rmSync} from 'node:fs';
import {request,type Server} from 'node:http';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {openRemoteLocalDb,openRemotePrivateControl,startRemoteLocalHost} from '../server/remoteLocalRuntime.ts';
import {RemoteNodeStatus} from '../server/remoteNodeStatus.ts';
import {RemoteHeartbeatAgent} from '../server/remoteHeartbeatAgent.ts';
import {RemoteCredentialVault} from '../server/remoteCredentialVault.ts';
import {provisionRemoteCredential} from '../server/remoteLocalProvision.ts';
import {listenPrivateOperator} from '../server/remotePrivateOperator.ts';

const host='workstation.example.ts.net',login='operator@example.invalid';
const key='vertical_snapshot_0001';
const temp=()=>mkdtempSync(join(realpathSync(tmpdir()),'forgia-remote-vertical-'));
function port(server:Server){
  const a=server.address();
  assert.ok(a&&typeof a!=='string');
  assert.equal(a.address,'127.0.0.1');
  return a.port;
}
function query(server:Server,token:string,path:string,method='GET',extra:string[]=[]){
  return new Promise<{status:number;body:string}>((resolve,reject)=>{
    const req=request({hostname:'127.0.0.1',port:port(server),path,method,agent:false,
      headers:['Host',host,'Tailscale-User-Login',login,'X-Forwarded-Proto','https',
        'Authorization','Bearer '+token,...extra]},res=>{
      let body='';res.setEncoding('utf8');res.on('data',chunk=>body+=chunk);
      res.on('end',()=>resolve({status:res.statusCode??0,body}));res.on('error',reject);
    });
    req.on('error',reject);req.setTimeout(5000,()=>req.destroy(Error('test timeout')));req.end();
  });
}
async function privateHost(directory:string){
  const db=openRemotePrivateControl(directory);
  try {
    const server=await listenPrivateOperator(new RemoteNodeStatus(db),{host,login,port:0});
    return {server,async close(){
      try{await new Promise<void>((resolve,reject)=>server.close(e=>e?reject(e):resolve()));}
      finally{db.close();}
    }};
  } catch(error){db.close();throw error;}
}
function withControl<T>(dir:string,fn:(store:RemoteNodeStatus)=>T):T{
  const db=openRemoteLocalDb(dir,'control');
  try{return fn(new RemoteNodeStatus(db));}finally{db.close();}
}
function loadToken(dir:string,role:'node'|'operator',vaultKey:string){
  const db=openRemoteLocalDb(dir,'vault');
  try{return new RemoteCredentialVault(db).read(role,vaultKey);}finally{db.close();}
}
const lookup=['Sec-Fetch-Site','same-origin','Idempotency-Key',key];
const submit=['Origin','https://'+host,...lookup,'Content-Length','0'];

test('RC58 private operator refuses absent or uninitialized state without bootstrapping',()=>{
  const dir=temp();
  try{
    assert.throws(()=>openRemotePrivateControl(dir));
    assert.equal(existsSync(join(dir,'control.sqlite')),false);
    const empty=openRemoteLocalDb(dir,'control');empty.close();
    assert.throws(()=>openRemotePrivateControl(dir),/initialized control state/);
    withControl(dir,s=>s.register('pc'));
    openRemotePrivateControl(dir).close();
  }finally{rmSync(dir,{recursive:true,force:true});}
});

test('RC59/RC60 durable vertical: vault provisioning, independent HTTP listeners, restart, recovery and live revocation',
 {timeout:30_000},async()=>{
  const root=temp(),state=join(root,'state'),vaultDir=join(root,'vault');
  mkdirSync(state,{mode:0o700});mkdirSync(vaultDir,{mode:0o700});
  const vaultKey=randomBytes(32).toString('hex');
  try{
    withControl(state,s=>s.register('pc'));
    const node=provisionRemoteCredential(state,vaultDir,'pc','node',120_000,vaultKey);
    const operator=provisionRemoteCredential(state,vaultDir,'pc','operator',120_000,vaultKey);
    const nodeToken=loadToken(vaultDir,'node',vaultKey),opToken=loadToken(vaultDir,'operator',vaultKey);
    let receiptId='';
    async function cycle(restart:boolean){
      const local=await startRemoteLocalHost(state,0);
      try{
        const remote=await privateHost(state);
        try{
          const agentDb=openRemoteLocalDb(state,'agent');
          try{
            const agent=new RemoteHeartbeatAgent(agentDb,port(local.server),nodeToken);
            try{
              const q=(path:string,method='GET',headers:string[]=[])=>query(remote.server,opToken,path,method,headers);
              assert.notEqual(port(local.server),port(remote.server));
              if(!restart){
                assert.equal(await agent.pulse(),'accepted');
                const status=await q('/v1/status');
                assert.equal(status.status,200);assert.equal(JSON.parse(status.body).online,true);
                const first=await q('/v1/snapshots','POST',submit);
                assert.equal(first.status,202);receiptId=JSON.parse(first.body).id;
                assert.match(receiptId,/^[a-f0-9-]{36}$/);
                assert.equal(JSON.parse((await q('/v1/snapshots/'+receiptId)).body).state,'queued');
              }else{
                const recovered=await q('/v1/snapshots','GET',lookup);
                assert.equal(recovered.status,200);assert.deepEqual(JSON.parse(recovered.body),{id:receiptId});
                assert.equal(JSON.parse((await q('/v1/snapshots/'+receiptId)).body).state,'queued');
                assert.equal(await agent.pulse(),'accepted');
                const done=await q('/v1/snapshots/'+receiptId);
                assert.equal(done.status,200);assert.equal(JSON.parse(done.body).state,'done');
                assert.equal(JSON.parse(done.body).sequence,2);
                assert.equal(await agent.pulse(),'accepted');
                assert.deepEqual(await q('/v1/snapshots/'+receiptId),done);
                withControl(state,s=>assert.equal(s.revoke(node.id),true));
                assert.equal(await agent.pulse(),'denied');
                const offline=await q('/v1/status');assert.equal(offline.status,200);
                assert.equal(JSON.parse(offline.body).online,false);
                withControl(state,s=>assert.equal(s.revoke(operator.id),true));
                assert.equal((await q('/v1/snapshots','GET',lookup)).status,401);
                assert.equal((await q('/v1/snapshots/'+receiptId)).status,401);
                assert.equal((await q('/v1/snapshots','POST',submit)).status,401);
              }
            }finally{await agent.stop();}
          }finally{agentDb.close();}
        }finally{await remote.close();}
      }finally{await local.close();}
    }
    await cycle(false);
    await cycle(true);
  }finally{rmSync(root,{recursive:true,force:true});}
});
