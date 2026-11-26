import {test, type TestContext} from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {RemoteNodeStatus} from '../server/remoteNodeStatus.ts';
import {listenRemoteStatus} from '../server/remoteStatusHttp.ts';

async function fixture(t: TestContext) {
  const db = new DatabaseSync(':memory:');
  const store = new RemoteNodeStatus(db);
  store.register('pc-a');
  store.register('pc-b');
  const node = store.issue('pc-a','node',60_000);
  const operator = store.issue('pc-a','operator',60_000);
  const other = store.issue('pc-b','operator',60_000);
  const server = await listenRemoteStatus(store);
  t.after(async () => {
    await new Promise<void>((resolve,reject) => server.close(e => e ? reject(e) : resolve()));
    db.close();
  });
  const addr = server.address();
  assert.ok(addr && typeof addr !== 'string');
  assert.equal(addr.address,'127.0.0.1');
  const base = 'http://127.0.0.1:'+addr.port;
  const request = (path:string,token:string,init:RequestInit={}) =>
    fetch(base+path,{...init,headers:new Headers({...Object.fromEntries(new Headers(init.headers)),Authorization:'Bearer '+token})});
  const heartbeat = (token:string,sequence:number) =>
    request('/v1/heartbeat',token,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({sequence})});
  return {store,node,operator,other,request,heartbeat,base};
}
test('RC7 real loopback HTTP heartbeat, scoped status, replay and revocation',async t => {
  const f = await fixture(t);
  const before = await f.request('/v1/status',f.operator.token);
  assert.equal(before.status,200);
  assert.equal((await before.json()).online,false);
  assert.equal((await f.heartbeat(f.node.token,1)).status,200);
  const state = await f.request('/v1/status',f.operator.token);
  assert.equal(state.headers.get('cache-control'),'no-store');
  assert.equal(state.headers.get('access-control-allow-origin'),null);
  assert.equal((await state.json()).online,true);
  const other = await f.request('/v1/status',f.other.token);
  assert.equal((await other.json()).node,'pc-b');
  assert.equal((await f.heartbeat(f.node.token,1)).status,401);
  assert.equal((await f.heartbeat(f.operator.token,2)).status,401);
  assert.equal((await f.request('/v1/status',f.node.token)).status,401);
  f.store.revoke(f.node.id);
  assert.equal((await f.heartbeat(f.node.token,2)).status,401);
  assert.equal((await (await f.request('/v1/status',f.operator.token)).json()).online,false);
  f.store.revoke(f.operator.id);
  assert.equal((await f.request('/v1/status',f.operator.token)).status,401);
});
test('RC8 host/origin, absent credential, query token and administration denied',async t => {
  const f = await fixture(t);
  assert.equal((await f.request('/v1/status',f.operator.token,{headers:{Host:'other.invalid'}})).status,403);
  assert.equal((await f.request('/v1/status',f.operator.token,{headers:{Origin:'https://other.invalid'}})).status,403);
  assert.equal((await f.request('/v1/status',f.operator.token,{headers:{Origin:f.base}})).status,200);
  assert.equal((await fetch(f.base+'/v1/status')).status,401);
  assert.equal((await f.request('/v1/status?node=pc-b',f.operator.token)).status,404);
  assert.equal((await f.request('/v1/register',f.operator.token,{method:'POST'})).status,404);
  assert.equal((await f.request('/v1/status',f.operator.token,{method:'OPTIONS'})).status,404);
});
test('RC9 invalid heartbeat input cannot advance sequence, gateway port refused',async t => {
  const f = await fixture(t);
  for (const body of ['{}','{"sequence":1,"node":"pc-b"}','{"sequence":0}','x',' '.repeat(129)]) {
    assert.equal((await f.request('/v1/heartbeat',f.node.token,{method:'POST',headers:{'Content-Type':'application/json'},body})).status,400);
  }
  assert.equal((await f.request('/v1/heartbeat',f.node.token,{method:'POST',body:'{"sequence":1}'})).status,400);
  assert.equal((await f.heartbeat(f.node.token,1)).status,200);
  await assert.rejects(listenRemoteStatus(f.store,8787));
});
