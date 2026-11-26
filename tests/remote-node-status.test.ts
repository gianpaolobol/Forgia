import {test} from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {mkdtempSync, rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {RemoteNodeStatus} from '../server/remoteNodeStatus.ts';

test('RC1 role, scope, TTL and digest-only storage', () => {
  const db = new DatabaseSync(':memory:');
  let now = 1000;
  try {
    const api = new RemoteNodeStatus(db,()=>now);
    api.register('a'); api.register('b');
    assert.throws(()=>api.issue('missing','node',1000));
    assert.throws(()=>api.issue('a','operator',86_400_001));
    const a = api.issue('a','operator',1000), b = api.issue('b','node',1000);
    assert.match(a.token,/^[a-f0-9]{64}$/);
    assert.notEqual(db.prepare('SELECT digest FROM rc_grants WHERE id=?').get(a.id)?.digest,a.token);
    assert.throws(()=>api.heartbeat(a.token,1));
    assert.throws(()=>api.status(b.token));
    assert.throws(()=>api.status('0'.repeat(64)));
    api.heartbeat(b.token,1);
    assert.deepEqual(api.status(a.token),{node:'a',online:false,lastSeenAt:null});
    now=2000;
    assert.throws(()=>api.status(a.token));
    assert.throws(()=>api.heartbeat(b.token,2));
  } finally {db.close();}
});

test('RC2 heartbeat replay, expiry, rotation and stale state',()=>{
  const db = new DatabaseSync(':memory:');
  let now=1000;
  try {
    const api=new RemoteNodeStatus(db,()=>now); api.register('pc');
    const op=api.issue('pc','operator',300_000), node=api.issue('pc','node',300_000);
    api.heartbeat(node.token,1);
    assert.equal(api.status(op.token).online,true);
    now=2000;
    assert.throws(()=>api.heartbeat(node.token,1));
    assert.equal(api.status(op.token).lastSeenAt,1000);
    now=91_000;
    assert.equal(api.status(op.token).online,false);
    api.heartbeat(node.token,2);
    assert.equal(api.status(op.token).online,true);
    const next=api.issue('pc','node',100);
    assert.equal(api.status(op.token).lastSeenAt,null);
    assert.throws(()=>api.heartbeat(node.token,3));
    assert.equal(api.revoke(node.id),false);
    api.heartbeat(next.token,1);
    now+=100;
    assert.equal(api.status(op.token).online,false);
    assert.throws(()=>api.heartbeat(next.token,2));
  } finally {db.close();}
});

test('RC3 revocation persists between independent connections and reopen',()=>{
  const dir=mkdtempSync(join(tmpdir(),'forgia-remote-'));
  const path=join(dir,'status.db');
  let db=new DatabaseSync(path);
  try {
    const api=new RemoteNodeStatus(db,()=>1000);api.register('pc');
    const op=api.issue('pc','operator',100_000), node=api.issue('pc','node',100_000);
    api.heartbeat(node.token,1);
    const other=new DatabaseSync(path);
    try {
      const second=new RemoteNodeStatus(other,()=>1100);
      assert.equal(second.status(op.token).online,true);
      assert.throws(()=>second.heartbeat(node.token,1));
      assert.equal(second.revoke(node.id),true);
      assert.throws(()=>api.heartbeat(node.token,2));
      assert.equal(api.status(op.token).online,false);
      assert.equal(second.revoke(op.id),true);
    } finally {other.close();}
    db.close();
    db=new DatabaseSync(path);
    const restarted=new RemoteNodeStatus(db,()=>1200);
    assert.throws(()=>restarted.status(op.token));
    assert.throws(()=>restarted.heartbeat(node.token,3));
  } finally {db.close();rmSync(dir,{recursive:true,force:true});}
});

test('RC4 invalid scope/sequence and clock rollback fail closed',()=>{
  const db=new DatabaseSync(':memory:');
  let now=1000;
  try {
    const api=new RemoteNodeStatus(db,()=>now);
    assert.throws(()=>api.register('../pc'));
    api.register('pc');
    const op=api.issue('pc','operator',100_000),node=api.issue('pc','node',100_000);
    for(const seq of [0,-1,1.1,NaN,Infinity,Number.MAX_SAFE_INTEGER+1]) assert.throws(()=>api.heartbeat(node.token,seq));
    now=2000;api.heartbeat(node.token,1);
    now=1500;
    assert.throws(()=>api.heartbeat(node.token,2));
    assert.equal(api.status(op.token).online,false);
    now=999;
    assert.throws(()=>api.status(op.token));
  } finally {db.close();}
});
