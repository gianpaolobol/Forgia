import {test, type TestContext} from 'node:test';
import assert from 'node:assert/strict';
import {createConnection} from 'node:net';
import {readRemoteNodeStatus} from '../src/core/remoteStatusClient.ts';
import {DatabaseSync} from 'node:sqlite';
import {RemoteNodeStatus} from '../server/remoteNodeStatus.ts';
import {listenRemoteStatus} from '../server/remoteStatusHttp.ts';

// fetch can normalize the Host header. Send exact wire bytes for header guards.
function rawStatus(port:number, headers:string[]): Promise<number> {
  return new Promise((resolve,reject) => {
    const socket = createConnection({host:'127.0.0.1',port});
    let data = '';
    socket.setTimeout(5000, () => socket.destroy(Error('raw HTTP timeout')));
    socket.on('error',reject);
    socket.on('connect',() => socket.write(['GET /v1/status HTTP/1.1',...headers,'Connection: close','',''].join('\r\n')));
    socket.on('data',chunk => { data += chunk.toString(); });
    socket.on('end',() => {
      const match = /^HTTP\/1\.[01] (\d{3}) /.exec(data);
      if (!match) reject(Error('Invalid raw HTTP response')); else resolve(Number(match[1]));
    });
  });
}

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
  return {store,node,operator,other,request,heartbeat,base,port:addr.port};
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
  const auth = 'Authorization: Bearer '+f.operator.token;
  const host = 'Host: 127.0.0.1:'+f.port;
  assert.equal(await rawStatus(f.port,[host,auth]),200);
  assert.equal(await rawStatus(f.port,['Host: other.invalid',auth]),403);
  assert.equal(await rawStatus(f.port,[host,'Host: other.invalid',auth]),403);
  assert.equal(await rawStatus(f.port,[host,auth,auth]),401);
  assert.equal(await rawStatus(f.port,[host,auth,'Origin: '+f.base,'Origin: '+f.base]),403);
  assert.equal(await rawStatus(f.port,[host,auth,'Sec-Fetch-Site: cross-site']),403);
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

test('RC10 typed operator client traverses HTTP and SQLite, denies revocation and invalid input',async t => {
  const f = await fixture(t);
  const before = await readRemoteNodeStatus(f.port,f.operator.token);
  assert.deepEqual(before,{node:'pc-a',online:false,lastSeenAt:null});
  assert.equal((await f.heartbeat(f.node.token,1)).status,200);
  const active = await readRemoteNodeStatus(f.port,f.operator.token);
  assert.equal(active.online,true);
  assert.equal(typeof active.lastSeenAt,'number');
  assert.equal((await readRemoteNodeStatus(f.port,f.other.token)).node,'pc-b');
  f.store.revoke(f.operator.id);
  await assert.rejects(readRemoteNodeStatus(f.port,f.operator.token),/unavailable/);
  await assert.rejects(readRemoteNodeStatus(8787,f.other.token),/configuration/);
  await assert.rejects(readRemoteNodeStatus(f.port,'not-a-token'),/configuration/);
});

test('RC11 client rejects unexpected result, refuses redirects and sends no cookies',async () => {
  const token = 'a'.repeat(64);
  const response = (body:string,status=200) => new Response(body,{status,headers:{'Content-Type':'application/json; charset=utf-8'}});
  for (const result of [
    response('{"node":"pc-a","online":true,"lastSeenAt":null}'),
    response('{"node":"pc-a","online":false,"lastSeenAt":-1}'),
    response('{"node":"pc-a","online":false,"lastSeenAt":null,"extra":1}'),
    response('{"node":"../pc","online":false,"lastSeenAt":null}'),
    response('{}',302),response('{}',401),response('x'.repeat(1025)),
  ]) {
    const fake:typeof fetch = async (url,init) => {
      assert.equal(url,'http://127.0.0.1:9000/v1/status');
      assert.equal(init?.redirect,'error');
      assert.equal(init?.credentials,'omit');
      assert.equal(init?.cache,'no-store');
      assert.equal(new Headers(init?.headers).get('Authorization'),'Bearer '+token);
      return result;
    };
    await assert.rejects(readRemoteNodeStatus(9000,token,fake),/unavailable/);
  }
});
