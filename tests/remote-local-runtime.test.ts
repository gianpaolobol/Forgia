import {test} from 'node:test';
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
