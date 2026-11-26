import {test} from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {mkdtempSync, rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createServer, type Server} from 'node:http';
import {RemoteNodeStatus} from '../server/remoteNodeStatus.ts';
import {listenRemoteStatus} from '../server/remoteStatusHttp.ts';
import {RemoteHeartbeatAgent} from '../server/remoteHeartbeatAgent.ts';
import {readRemoteNodeStatus} from '../src/core/remoteStatusClient.ts';

function port(server: Server) {
  const addr = server.address();
  if (!addr || typeof addr === 'string') throw Error('Missing test port');
  return addr.port;
}
const close = (server: Server) => new Promise<void>((resolve,reject) =>
  server.close(error => error ? reject(error) : resolve()));

test('RC13 node agent to HTTP SQLite to operator, restart and revocation', async () => {
  const dir = mkdtempSync(join(tmpdir(),'forgia-heartbeat-'));
  const db = new DatabaseSync(':memory:');
  let agentDb = new DatabaseSync(join(dir,'agent.db'));
  const store = new RemoteNodeStatus(db);
  store.register('pilot');
  const node = store.issue('pilot','node',60_000);
  const op = store.issue('pilot','operator',60_000);
  const server = await listenRemoteStatus(store);
  try {
    const p = port(server);
    assert.equal((await readRemoteNodeStatus(p,op.token)).online,false);
    let agent = new RemoteHeartbeatAgent(agentDb,p,node.token);
    const a = agent.pulse(); const b = agent.pulse();
    assert.equal(a,b);
    assert.equal(await a,'accepted');
    assert.equal((await readRemoteNodeStatus(p,op.token)).online,true);
    assert.equal(agentDb.prepare('SELECT seq FROM rc_agent_sequence').get()?.seq,1);
    assert.ok(!JSON.stringify(agentDb.prepare('SELECT * FROM rc_agent_sequence').all()).includes(node.token));
    await agent.stop();
    agentDb.close();
    agentDb = new DatabaseSync(join(dir,'agent.db'));
    agent = new RemoteHeartbeatAgent(agentDb,p,node.token);
    assert.equal(await agent.pulse(),'accepted');
    assert.equal(agentDb.prepare('SELECT seq FROM rc_agent_sequence').get()?.seq,2);
    store.revoke(node.id);
    assert.equal(await agent.pulse(),'denied');
    assert.equal((await readRemoteNodeStatus(p,op.token)).online,false);
    await agent.stop();
  } finally { await close(server); agentDb.close(); db.close(); rmSync(dir,{recursive:true,force:true}); }
});

test('RC14 uncertain response consumes sequence and next heartbeat does not replay', async () => {
  const db = new DatabaseSync(':memory:');
  const agentDb = new DatabaseSync(':memory:');
  const store = new RemoteNodeStatus(db);
  store.register('pilot');
  const node = store.issue('pilot','node',60_000);
  const op = store.issue('pilot','operator',60_000);
  const observed: number[] = [];
  const server = createServer(async (req,res) => {
    const chunks: Buffer[] = [];
    for await (const chunk of req) chunks.push(Buffer.from(chunk));
    const value = JSON.parse(Buffer.concat(chunks).toString('utf8'));
    observed.push(value.sequence);
    const result = store.heartbeat(node.token,value.sequence);
    if (observed.length === 1) { req.socket.destroy(); return; }
    res.writeHead(200,{'Content-Type':'application/json; charset=utf-8','Connection':'close'});
    res.end(JSON.stringify(result));
  });
  await new Promise<void>(resolve => server.listen(0,'127.0.0.1',resolve));
  try {
    const agent = new RemoteHeartbeatAgent(agentDb,port(server),node.token);
    assert.equal(await agent.pulse(),'unavailable');
    assert.equal(store.status(op.token).online,true);
    assert.equal(await agent.pulse(),'accepted');
    assert.deepEqual(observed,[1,2]);
    await agent.stop();
  } finally { await close(server); agentDb.close(); db.close(); }
});

test('RC15 no redirect and bounded invalid response; replacement uses new sequence', async () => {
  const db = new DatabaseSync(':memory:');
  const agentDb = new DatabaseSync(':memory:');
  const store = new RemoteNodeStatus(db);
  store.register('pilot');
  const node = store.issue('pilot','node',60_000);
  let calls = 0;
  const fake = createServer((req,res) => {
    req.resume(); calls++;
    if (calls === 1) {
      res.writeHead(307,{Location:'/redirect','Connection':'close'}); res.end(); return;
    }
    res.writeHead(200,{'Content-Type':'application/json; charset=utf-8','Connection':'close'});
    res.end('x'.repeat(300));
  });
  const real = await listenRemoteStatus(store);
  await new Promise<void>(resolve => fake.listen(0,'127.0.0.1',resolve));
  try {
    const agent = new RemoteHeartbeatAgent(agentDb,port(fake),node.token);
    assert.equal(await agent.pulse(),'unavailable');
    assert.equal(calls,1);
    assert.equal(await agent.pulse(),'unavailable');
    assert.equal(calls,2);
    assert.throws(() => new RemoteHeartbeatAgent(agentDb,8787,node.token));
    assert.throws(() => agent.start(1));
    const newNode = store.issue('pilot','node',60_000);
    const replacement = new RemoteHeartbeatAgent(agentDb,port(real),newNode.token);
    assert.equal(await replacement.pulse(),'accepted');
    assert.deepEqual(agentDb.prepare('SELECT seq FROM rc_agent_sequence ORDER BY seq').all().map(x=>x.seq),[1,2]);
    await replacement.stop();
  } finally { await close(fake); await close(real); agentDb.close(); db.close(); }
});
