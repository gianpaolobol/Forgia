import {test} from 'node:test';
import {spawn,spawnSync} from 'node:child_process';
import {fileURLToPath,URL} from 'node:url';
import assert from 'node:assert/strict';
import {chmodSync, mkdtempSync, realpathSync, rmSync, writeFileSync, symlinkSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {openRemoteLocalDb,startRemoteLocalHost} from '../server/remoteLocalRuntime.ts';
import {RemoteNodeStatus} from '../server/remoteNodeStatus.ts';
import {RemoteHeartbeatAgent} from '../server/remoteHeartbeatAgent.ts';
import {readRemoteNodeStatus} from '../src/core/remoteStatusClient.ts';

const temp = () => mkdtempSync(join(realpathSync(tmpdir()),'forgia-remote-local-'));
test('RC16 local host with separate durable databases, restart and administrative revocation', async () => {
  const dir = temp();
  try {
    let db = openRemoteLocalDb(dir,'control');
    const store = new RemoteNodeStatus(db);
    store.register('pc');
    const node = store.issue('pc','node',60_000);
    const op = store.issue('pc','operator',60_000);
    db.close();
    let host = await startRemoteLocalHost(dir,0);
    const agentDb = openRemoteLocalDb(dir,'agent');
    try {
      const address = host.server.address();
      assert.ok(address && typeof address !== 'string');
      assert.equal(address.address,'127.0.0.1');
      const agent = new RemoteHeartbeatAgent(agentDb,address.port,node.token);
      assert.equal(await agent.pulse(),'accepted');
      assert.equal((await readRemoteNodeStatus(address.port,op.token)).online,true);
      await agent.stop();
      assert.equal(host.close(),host.close());
      await host.close();
      host = await startRemoteLocalHost(dir,0);
      const next = host.server.address();
      assert.ok(next && typeof next !== 'string');
      const resumed = new RemoteHeartbeatAgent(agentDb,next.port,node.token);
      assert.equal(await resumed.pulse(),'accepted');
      db = openRemoteLocalDb(dir,'control');
      try { assert.equal(new RemoteNodeStatus(db).revoke(node.id),true); } finally { db.close(); }
      assert.equal(await resumed.pulse(),'denied');
      assert.equal((await readRemoteNodeStatus(next.port,op.token)).online,false);
      await resumed.stop();
    } finally { await host.close(); agentDb.close(); }
  } finally { rmSync(dir,{recursive:true,force:true}); }
});

test('RC17 local state rejects relative paths, missing directories and gateway port', async () => {
  const dir = temp();
  try {
    assert.throws(() => openRemoteLocalDb('relative','control'));
    assert.throws(() => openRemoteLocalDb(join(dir,'missing'),'control'));
    await assert.rejects(startRemoteLocalHost(dir,8787));
    const host = await startRemoteLocalHost(dir,0);
    await host.close();
  } finally { rmSync(dir,{recursive:true,force:true}); }
});

test('RC18 private POSIX state refuses permissive directory and redirected database/sidecar', {skip:process.platform==='win32'}, () => {
  const dir = temp();
  try {
    chmodSync(dir,0o755);
    assert.throws(() => openRemoteLocalDb(dir,'control'));
    chmodSync(dir,0o700);
    const outside = join(dir,'other');
    writeFileSync(outside,'unchanged',{mode:0o600});
    const path = join(dir,'control.sqlite');
    symlinkSync(outside,path);
    assert.throws(() => openRemoteLocalDb(dir,'control'));
    rmSync(path);
    const db = openRemoteLocalDb(dir,'control'); db.close();
    symlinkSync(outside,path+'-journal');
    assert.throws(() => openRemoteLocalDb(dir,'control'));
  } finally { chmodSync(dir,0o700); rmSync(dir,{recursive:true,force:true}); }
});

test('RC19 CLI refuses noninteractive administration and invalid credential pipe without echo', () => {
  const dir = temp();
  const script = fileURLToPath(new URL('../scripts/remote-local.ts',import.meta.url));
  const invalid = 'synthetic-invalid-credential';
  const run = (args: string[], input = '') => spawnSync(process.execPath,
    ['--experimental-strip-types',script,...args],{input,encoding:'utf8',timeout:10_000});
  try {
    const admin = run(['register',dir,'pc']);
    assert.equal(admin.status,1);
    assert.equal(admin.stdout,'');
    const agent = run(['agent',dir,'8791'],invalid);
    assert.equal(agent.status,1);
    assert.equal(agent.stdout,'');
    assert.ok(!agent.stderr.includes(invalid));
  } finally { rmSync(dir,{recursive:true,force:true}); }
});

test('RC20 operator CLI reads live local status through private stdin, never echoes credential', {timeout:30_000}, async () => {
  const dir = temp();
  const script = fileURLToPath(new URL('../scripts/remote-local.ts',import.meta.url));
  const db = openRemoteLocalDb(dir,'control');
  const store = new RemoteNodeStatus(db);
  store.register('pc');
  const node = store.issue('pc','node',120_000);
  const op = store.issue('pc','operator',120_000);
  db.close();
  const host = await startRemoteLocalHost(dir,0);
  const agentDb = openRemoteLocalDb(dir,'agent');
  try {
    const address = host.server.address();
    assert.ok(address && typeof address !== 'string');
    const agent = new RemoteHeartbeatAgent(agentDb,address.port,node.token);
    const query = (token: string, port = address.port) => new Promise<{code: number|null; stdout: string; stderr: string}>((resolve,reject) => {
      const child = spawn(process.execPath,['--experimental-strip-types',script,'status',String(port)],
        {stdio:['pipe','pipe','pipe'],timeout:10_000});
      let stdout='',stderr='';
      child.stdout.setEncoding('utf8').on('data',chunk => { stdout+=chunk; });
      child.stderr.setEncoding('utf8').on('data',chunk => { stderr+=chunk; });
      child.once('error',reject);
      child.stdin.on('error',reject);
      child.once('close',code => resolve({code,stdout,stderr}));
      child.stdin.end(token+'\n');
    });
    try {
      assert.equal(await agent.pulse(),'accepted');
      const allowed = await query(op.token);
      assert.equal(allowed.code,0);
      assert.deepEqual(JSON.parse(allowed.stdout),await readRemoteNodeStatus(address.port,op.token));
      assert.ok(!allowed.stdout.includes(op.token) && !allowed.stderr.includes(op.token));
      // Wrong role and forbidden gateway port are failures, not offline results.
      for (const denied of [await query(node.token),await query(op.token,8787)]) {
        assert.equal(denied.code,1);
        assert.equal(denied.stdout,'');
        assert.ok(!denied.stderr.includes(node.token) && !denied.stderr.includes(op.token));
      }
      const admin = openRemoteLocalDb(dir,'control');
      try { assert.equal(new RemoteNodeStatus(admin).revoke(op.id),true); } finally { admin.close(); }
      const revoked=await query(op.token);
      assert.equal(revoked.code,1);
      assert.equal(revoked.stdout,'');
      assert.ok(!revoked.stderr.includes(op.token));
    } finally { await agent.stop(); }
  } finally { await host.close(); agentDb.close(); rmSync(dir,{recursive:true,force:true}); }
});

test('RC21 operator CLI rejects malformed pipe without echo', () => {
  const script = fileURLToPath(new URL('../scripts/remote-local.ts',import.meta.url));
  const invalid='invalid-synthetic-operator-token';
  const result=spawnSync(process.execPath,['--experimental-strip-types',script,'status','8791'],
    {input:invalid,encoding:'utf8',timeout:10_000});
  assert.equal(result.status,1);
  assert.equal(result.stdout,'');
  assert.ok(!result.stderr.includes(invalid));
});
