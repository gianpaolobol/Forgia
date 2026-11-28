import {test} from 'node:test';
import assert from 'node:assert/strict';
import {randomBytes} from 'node:crypto';
import {mkdtempSync,realpathSync,rmSync,readFileSync,existsSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {spawn,spawnSync} from 'node:child_process';
import {fileURLToPath,URL} from 'node:url';
import {openRemoteLocalDb,startRemoteLocalHost} from '../server/remoteLocalRuntime.ts';
import {RemoteCredentialVault} from '../server/remoteCredentialVault.ts';
import {RemoteNodeStatus} from '../server/remoteNodeStatus.ts';
import {RemoteHeartbeatAgent} from '../server/remoteHeartbeatAgent.ts';

const temp=()=>mkdtempSync(join(realpathSync(tmpdir()),'forgia-vault-'));
const key=()=>randomBytes(32).toString('hex');
const script=fileURLToPath(new URL('../scripts/remote-local.ts',import.meta.url));
const run=(args:string[],input:string)=>spawnSync(process.execPath,
  ['--experimental-strip-types',script,...args],{input,encoding:'utf8',timeout:10_000});

test('RC22 vault persists authenticated ciphertext, refuses wrong key and overwrite',()=>{
  const dir=temp(), k=key(), token=key();
  try {
    let db=openRemoteLocalDb(dir,'vault');
    try {
      const vault=new RemoteCredentialVault(db);
      vault.import('operator',k,token);
      assert.throws(()=>vault.import('operator',k,key()));
      assert.throws(()=>vault.read('node',k));
    } finally { db.close(); }
    const raw=readFileSync(join(dir,'credentials.sqlite'));
    assert.ok(!raw.includes(Buffer.from(token)) && !raw.includes(Buffer.from(k)));
    db=openRemoteLocalDb(dir,'vault');
    try {
      const vault=new RemoteCredentialVault(db);
      assert.equal(vault.read('operator',k),token);
      assert.throws(()=>vault.read('operator',key()));
      db.exec("UPDATE remote_credential_v1 SET role='node' WHERE role='operator'");
      assert.throws(()=>vault.read('node',k));
      db.exec("UPDATE remote_credential_v1 SET role='operator',tag=zeroblob(16)");
      assert.throws(()=>vault.read('operator',k));
    } finally { db.close(); }
  } finally { rmSync(dir,{recursive:true,force:true}); }
});

test('RC23 encrypted operator CLI reaches real loopback status and respects revocation',{timeout:30_000},async()=>{
  const dir=temp(),vd=temp(),k=key();
  const db=openRemoteLocalDb(dir,'control');
  const store=new RemoteNodeStatus(db);
  store.register('pc');
  const node=store.issue('pc','node',120_000);
  const op=store.issue('pc','operator',120_000);
  db.close();
  const host=await startRemoteLocalHost(dir,0);
  const agentDb=openRemoteLocalDb(dir,'agent');
  try {
    const address=host.server.address();
    assert.ok(address && typeof address!=='string');
    const agent=new RemoteHeartbeatAgent(agentDb,address.port,node.token);
    const query=(secret:string)=>new Promise<{code:number|null;out:string;err:string}>((resolve,reject)=>{
      const child=spawn(process.execPath,['--experimental-strip-types',script,'status-vault',vd,String(address.port)],{stdio:['pipe','pipe','pipe'],timeout:10_000});
      let out='',err='';
      child.stdout.setEncoding('utf8').on('data',x=>{out+=x;});
      child.stderr.setEncoding('utf8').on('data',x=>{err+=x;});
      child.once('error',reject); child.stdin.on('error',reject);
      child.once('close',code=>resolve({code,out,err}));
      child.stdin.end(secret+'\n');
    });
    try {
      const imported=run(['vault-import',vd,'operator'],k+'\n'+op.token+'\n');
      assert.equal(imported.status,0);
      assert.ok(!(imported.stdout+imported.stderr).includes(op.token));
      assert.equal(await agent.pulse(),'accepted');
      const allowed=await query(k);
      assert.equal(allowed.code,0);
      assert.equal(JSON.parse(allowed.out).online,true);
      assert.ok(!(allowed.out+allowed.err).includes(k) && !(allowed.out+allowed.err).includes(op.token));
      const denied=await query(key()); assert.equal(denied.code,1); assert.equal(denied.out,'');
      const admin=openRemoteLocalDb(dir,'control');
      try { assert.equal(new RemoteNodeStatus(admin).revoke(op.id),true); } finally { admin.close(); }
      const revoked=await query(k); assert.equal(revoked.code,1); assert.equal(revoked.out,'');
    } finally { await agent.stop(); }
  } finally { await host.close(); agentDb.close(); rmSync(dir,{recursive:true,force:true});rmSync(vd,{recursive:true,force:true}); }
});

test('RC24 vault import rejects malformed pipe and never echoes secrets',()=>{
  const dir=temp(),k=key();
  try {
    const result=run(['vault-import',dir,'node'],k+'\ninvalid\n');
    assert.equal(result.status,1); assert.equal(result.stdout,'');
    assert.ok(!result.stderr.includes(k));
    const forbidden=run(['status-vault',dir,'8787'],k+'\n');
    assert.equal(forbidden.status,1); assert.equal(forbidden.stdout,'');
  } finally { rmSync(dir,{recursive:true,force:true}); }
});


test('RC63 runtime vault reads refuse missing or uninitialized archives without bootstrap',()=>{
  const dir=temp(), k=key();
  try {
    const denied=run(['status-vault',dir,'8791'],k+'\n');
    assert.equal(denied.status,1);assert.equal(denied.stdout,'');
    assert.ok(!denied.stderr.includes(k));
    assert.equal(existsSync(join(dir,'credentials.sqlite')),false);
    const db=openRemoteLocalDb(dir,'vault');db.close();
    const empty=run(['status-vault',dir,'8791'],k+'\n');
    assert.equal(empty.status,1);assert.equal(empty.stdout,'');
    const check=openRemoteLocalDb(dir,'vault',true);
    try { assert.equal(check.prepare("SELECT 1 FROM sqlite_schema WHERE name='remote_credential_v1'").get(),undefined); }
    finally { check.close(); }
  } finally { rmSync(dir,{recursive:true,force:true}); }
});
