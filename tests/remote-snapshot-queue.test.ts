import {test} from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {RemoteNodeStatus} from '../server/remoteNodeStatus.ts';

const key='snapshot_key_0001';
test('RC46 diagnostic receipt is durable and completed exactly once by a heartbeat',()=>{
  const dir=mkdtempSync(join(tmpdir(),'forgia-rc46-'));
  let db=new DatabaseSync(join(dir,'control.sqlite')),now=1000;
  try {
    let s=new RemoteNodeStatus(db,()=>now);
    s.register('pc');
    const op=s.issue('pc','operator',10000),worker=s.issue('pc','node',10000);
    const receipt=s.requestSnapshot(op.token,key);
    assert.deepEqual(s.requestSnapshot(op.token,key),receipt);
    assert.equal(s.readSnapshot(op.token,receipt.id).state,'queued');
    db.close();db=new DatabaseSync(join(dir,'control.sqlite'));
    s=new RemoteNodeStatus(db,()=>now);
    now=2000;s.heartbeat(worker.token,1);
    const done=s.readSnapshot(op.token,receipt.id);
    assert.deepEqual(done,{id:receipt.id,node:'pc',state:'done',createdAt:1000,completedAt:2000,sequence:1});
    now=3000;s.heartbeat(worker.token,2);
    assert.deepEqual(s.readSnapshot(op.token,receipt.id),done);
    assert.deepEqual(s.requestSnapshot(op.token,key),receipt);
  } finally {db.close();rmSync(dir,{recursive:true,force:true});}
});
test('RC47 scope isolates operators, nodes and role; a heartbeat completes only one job',()=>{
  const db=new DatabaseSync(':memory:');
  try {
    const s=new RemoteNodeStatus(db,()=>1000);
    s.register('pc');s.register('other');
    const op=s.issue('pc','operator',10000),second=s.issue('pc','operator',10000);
    const worker=s.issue('pc','node',10000),other=s.issue('other','node',10000);
    const a=s.requestSnapshot(op.token,key),b=s.requestSnapshot(second.token,key);
    assert.notEqual(a.id,b.id);
    assert.throws(()=>s.readSnapshot(second.token,a.id));
    assert.throws(()=>s.requestSnapshot(worker.token,key));
    assert.throws(()=>s.readSnapshot(worker.token,a.id));
    s.heartbeat(other.token,1);
    assert.equal(s.readSnapshot(op.token,a.id).state,'queued');
    s.heartbeat(worker.token,1);
    const states=[s.readSnapshot(op.token,a.id).state,s.readSnapshot(second.token,b.id).state];
    assert.deepEqual(states.sort(),['done','queued']);
    s.heartbeat(worker.token,2);
    assert.equal(s.readSnapshot(op.token,a.id).state,'done');
    assert.equal(s.readSnapshot(second.token,b.id).state,'done');
  } finally {db.close();}
});
test('RC48 node rotation, expiry and operator revocation cannot revive pending work',()=>{
  const db=new DatabaseSync(':memory:');let now=1000;
  try {
    const s=new RemoteNodeStatus(db,()=>now);s.register('pc');
    const op=s.issue('pc','operator',10000),worker=s.issue('pc','node',1000);
    const a=s.requestSnapshot(op.token,key);
    now=2000;
    assert.equal(s.readSnapshot(op.token,a.id).state,'cancelled');
    const replacement=s.issue('pc','node',10000);
    assert.throws(()=>s.heartbeat(worker.token,1));
    s.heartbeat(replacement.token,1);
    assert.equal(s.readSnapshot(op.token,a.id).state,'cancelled');
    assert.deepEqual(s.requestSnapshot(op.token,key),a);
    const b=s.requestSnapshot(op.token,'snapshot_key_0002');
    s.revoke(op.id);s.heartbeat(replacement.token,2);
    assert.throws(()=>s.readSnapshot(op.token,b.id));
    assert.equal(db.prepare('SELECT completed FROM rc_snapshots WHERE id=?').get(b.id)?.completed,null);
    const fresh=s.issue('pc','operator',10000);
    assert.throws(()=>s.readSnapshot(fresh.token,b.id));
    assert.notEqual(s.requestSnapshot(fresh.token,key).id,a.id);
  } finally {db.close();}
});
test('RC49 caps requests and rejects malformed keys without accepting arbitrary payloads',()=>{
  const db=new DatabaseSync(':memory:');let now=1000;
  try {
    const s=new RemoteNodeStatus(db,()=>now);s.register('pc');
    const op=s.issue('pc','operator',1000);s.issue('pc','node',10000);
    assert.throws(()=>s.requestSnapshot(op.token,'bad'));
    const ids=Array.from({length:32},(_,i)=>s.requestSnapshot(op.token,'snapshot_key_'+String(i).padStart(4,'0')));
    assert.throws(()=>s.requestSnapshot(op.token,'snapshot_key_0032'));
    assert.deepEqual(s.requestSnapshot(op.token,'snapshot_key_0000'),ids[0]);
    now=2000;const fresh=s.issue('pc','operator',10000);
    assert.throws(()=>s.readSnapshot(op.token,ids[0].id));
    s.requestSnapshot(fresh.token,key);
    assert.equal(db.prepare('SELECT COUNT(*) AS n FROM rc_snapshots').get()?.n,1);
    for(let i=0;i<7;i++){
      const next=s.issue('pc','operator',10000);
      for(let j=0;j<32;j++)s.requestSnapshot(next.token,'snapshot_key_'+String(j).padStart(4,'0'));
    }
    for(let j=1;j<32;j++)s.requestSnapshot(fresh.token,'extra_snapshot_'+String(j).padStart(4,'0'));
    const overflow=s.issue('pc','operator',10000);
    assert.throws(()=>s.requestSnapshot(overflow.token,key));
    assert.equal(db.prepare('SELECT COUNT(*) AS n FROM rc_snapshots').get()?.n,256);
  }finally{db.close();}
});
test('RC50 a rejected/replayed heartbeat or rolled-back clock cannot complete a queued receipt',()=>{
  const db=new DatabaseSync(':memory:');let now=1000;
  try {
    const s=new RemoteNodeStatus(db,()=>now);s.register('pc');
    const op=s.issue('pc','operator',10000),worker=s.issue('pc','node',10000);
    s.heartbeat(worker.token,1);const a=s.requestSnapshot(op.token,key);
    assert.throws(()=>s.heartbeat(worker.token,1));
    now=999;assert.throws(()=>s.heartbeat(worker.token,2));
    now=1001;assert.equal(s.readSnapshot(op.token,a.id).state,'queued');
    s.heartbeat(worker.token,2);assert.equal(s.readSnapshot(op.token,a.id).sequence,2);
  }finally{db.close();}
});
