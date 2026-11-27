import {test} from 'node:test';
import assert from 'node:assert/strict';
import {randomBytes} from 'node:crypto';
import {mkdtempSync,mkdirSync,realpathSync,rmSync,readFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {openRemoteLocalDb,startRemoteLocalHost} from '../server/remoteLocalRuntime.ts';
import {RemoteCredentialVault} from '../server/remoteCredentialVault.ts';
import {RemoteNodeStatus} from '../server/remoteNodeStatus.ts';
import {provisionRemoteCredential} from '../server/remoteLocalProvision.ts';
import {readRemoteNodeStatus} from '../src/core/remoteStatusClient.ts';
import {spawnSync} from 'node:child_process';
import {fileURLToPath,URL} from 'node:url';

const key=()=>randomBytes(32).toString('hex');
function fixture(){
  const root=mkdtempSync(join(realpathSync(tmpdir()),'forgia-provision-'));
  const state=join(root,'state'),vault=join(root,'vault'),next=join(root,'next');
  for(const path of [state,vault,next])mkdirSync(path,{mode:0o700});
  const db=openRemoteLocalDb(state,'control');
  try{new RemoteNodeStatus(db).register('pc');}finally{db.close();}
  return {root,state,vault,next,cleanup:()=>rmSync(root,{recursive:true,force:true})};
}
function read(dir:string,role:'node'|'operator',k:string){
  const db=openRemoteLocalDb(dir,'vault');
  try{return new RemoteCredentialVault(db).read(role,k);}finally{db.close();}
}
test('RC37 direct local provisioning traverses encrypted vault and real HTTP without returning token',async()=>{
  const f=fixture(),k=key();
  try{
    const grant=provisionRemoteCredential(f.state,f.vault,'pc','operator',120000,k);
    assert.deepEqual(Object.keys(grant).sort(),['expiresAt','id']);
    const token=read(f.vault,'operator',k);
    for(const file of [join(f.state,'control.sqlite'),join(f.vault,'credentials.sqlite')]){
      const raw=readFileSync(file);
      assert.ok(!raw.includes(Buffer.from(token)));assert.ok(!raw.includes(Buffer.from(k)));
    }
    const host=await startRemoteLocalHost(f.state,0);
    try{
      const address=host.server.address();assert.ok(address&&typeof address!=='string');
      assert.equal((await readRemoteNodeStatus(address.port,token)).node,'pc');
      const db=openRemoteLocalDb(f.state,'control');
      try{assert.equal(new RemoteNodeStatus(db).revoke(grant.id),true);}finally{db.close();}
      await assert.rejects(readRemoteNodeStatus(address.port,token),/unavailable/);
    }finally{await host.close();}
  }finally{f.cleanup();}
});
test('RC38 failed vault insertion preserves existing node authority and heartbeat; explicit rotation works',()=>{
  const f=fixture(),k=key();
  try{
    const old=provisionRemoteCredential(f.state,f.vault,'pc','node',120000,k);
    const token=read(f.vault,'node',k);
    const db=openRemoteLocalDb(f.state,'control');
    try{
      const api=new RemoteNodeStatus(db);
      const op=api.issue('pc','operator',120000);
      api.heartbeat(token,1);
      assert.throws(()=>provisionRemoteCredential(f.state,f.vault,'pc','node',120000,k));
      assert.equal(api.status(op.token).online,true);
      api.heartbeat(token,2);
      assert.ok(api.inspectGrants('pc').some(g=>g.id===old.id));
      const rotated=provisionRemoteCredential(f.state,f.next,'pc','node',120000,k);
      assert.equal(api.status(op.token).online,false);
      assert.throws(()=>api.heartbeat(token,3));
      api.heartbeat(read(f.next,'node',k),1);
      assert.equal(api.status(op.token).online,true);
      assert.ok(api.inspectGrants('pc').some(g=>g.id===rotated.id));
      assert.ok(!api.inspectGrants('pc').some(g=>g.id===old.id));
    }finally{db.close();}
  }finally{f.cleanup();}
});
test('RC39 inventory is redacted, scoped and usable for revocation even after clock rollback',()=>{
  const f=fixture();
  try{
    const db=openRemoteLocalDb(f.state,'control');
    try{
      let now=1000;const api=new RemoteNodeStatus(db,()=>now);
      api.register('other');
      const grant=api.issue('pc','operator',100);
      api.issue('other','operator',100);
      now=1200;assert.throws(()=>api.status(grant.token));now=900;
      const inventory=api.inspectGrants('pc');
      assert.deepEqual(inventory,[{id:grant.id,role:'operator',createdAt:1000,expiresAt:1100}]);
      assert.ok(!JSON.stringify(inventory).includes(grant.token));
      assert.equal(api.revoke(grant.id),true);assert.deepEqual(api.inspectGrants('pc'),[]);
      assert.throws(()=>api.inspectGrants('missing'));
    }finally{db.close();}
  }finally{f.cleanup();}
});
test('RC40 malformed or overlapping provisioning and noninteractive admin CLI refused',()=>{
  const f=fixture();
  try{
    assert.throws(()=>provisionRemoteCredential(f.state,f.state,'pc','node',1000,key()));
    assert.throws(()=>provisionRemoteCredential(f.state,f.vault,'pc','node',1000,'bad'));
    const script=fileURLToPath(new URL('../scripts/remote-local.ts',import.meta.url));
    for(const args of [['inspect-grants',f.state,'pc'],['provision-os',f.state,'pc','node','1',f.vault,f.next]]){
      const child=spawnSync(process.execPath,['--experimental-strip-types',script,...args],{input:'',encoding:'utf8',timeout:10000});
      assert.equal(child.status,1);assert.equal(child.stdout,'');
    }
  }finally{f.cleanup();}
});
