import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { NotificationHub } from '../server/notificationHub.ts';
import { NotificationDelivery } from '../server/notificationDelivery.ts';
const event={version:1,id:'event1',source:'fixture',project:'demo/project',type:'ci.failed',severity:'critical',timestamp:100,correlation_id:'run1'};
function fixture(db: DatabaseSync) {
  const hub=new NotificationHub(db); hub.setPreference('alice',event.project,'telegram',true); hub.publish('alice',event,101);
  return {hub,worker:new NotificationDelivery(db)};
}
test('N2 claim exclusive across connections, stale lease fenced, sent never replayed',()=>{
  const dir=mkdtempSync(join(tmpdir(),'forgia-delivery-')); const file=join(dir,'db.sqlite');
  const a=new DatabaseSync(file), b=new DatabaseSync(file);
  try {
    const {worker}=fixture(a), second=new NotificationDelivery(b);
    const first=worker.claim('alice','telegram',100)!; assert.ok(first);
    assert.equal(second.claim('alice','telegram',101),null);
    assert.equal(second.claim('bob','telegram',101),null);
    const next=second.claim('alice','telegram',60_100)!; assert.ok(next);
    assert.notEqual(first.fence,next.fence); assert.equal(worker.begin(first,60_101),null);
    assert.equal(second.begin(next,60_101)?.event.summary,'CI fallita');
    assert.equal(worker.finish(first,'sent',60_102),false);
    assert.equal(second.finish(next,'sent',60_102),true);
    assert.equal(worker.claim('alice','telegram',200_000),null);
    assert.equal(worker.status('alice')[0].state,'sent');
  } finally {a.close();b.close();rmSync(dir,{recursive:true,force:true});}
});
test('N2 crash after send intent quarantines uncertainty across restart',()=>{
  const dir=mkdtempSync(join(tmpdir(),'forgia-delivery-')); const file=join(dir,'db.sqlite');
  let db=new DatabaseSync(file);
  try {
    let {worker}=fixture(db); const c=worker.claim('alice','telegram',100)!;
    assert.ok(worker.begin(c,101)); db.close(); db=new DatabaseSync(file); worker=new NotificationDelivery(db);
    assert.equal(worker.claim('alice','telegram',60_101),null);
    assert.equal(worker.status('alice')[0].state,'uncertain'); assert.equal(worker.finish(c,'not-sent',60_102),false);
    assert.equal(worker.claim('alice','telegram',600_000),null);
  } finally {db.close();rmSync(dir,{recursive:true,force:true});}
});
test('N2 revocation before dispatch remains effective after re-opt-in',()=>{
  const db=new DatabaseSync(':memory:');try {
    const {hub,worker}=fixture(db); const c=worker.claim('alice','telegram',100)!;
    hub.setPreference('alice',event.project,'telegram',false);hub.setPreference('alice',event.project,'telegram',true);
    assert.equal(worker.begin(c,101),null);assert.equal(worker.status('alice')[0].state,'revoked');
    assert.equal(worker.claim('alice','telegram',200_000),null);
  } finally {db.close();}
});
test('N2 retry only proven non-delivery, bounded exponential delay, dead-letter',async()=>{
  const db=new DatabaseSync(':memory:');try {
    const {worker}=fixture(db); let now=100, sends=0;
    const send=async()=>{sends++;return 'not-sent' as const;};
    assert.equal(await worker.runOnce('alice','telegram',send,()=>now),true);
    now=30_099;assert.equal(await worker.runOnce('alice','telegram',send,()=>now),false);
    now=30_100;assert.equal(await worker.runOnce('alice','telegram',send,()=>now),true);
    now=90_100;assert.equal(await worker.runOnce('alice','telegram',send,()=>now),true);
    now=900_000;assert.equal(await worker.runOnce('alice','telegram',send,()=>now),false);
    assert.equal(sends,3);assert.equal(worker.status('alice')[0].state,'dead');assert.equal(worker.status('alice')[0].attempts,3);
  } finally {db.close();}
});
test('N2 transport exception is uncertain, not retried; owner scope separate',async()=>{
  const db=new DatabaseSync(':memory:');try {
    const {worker,hub}=fixture(db);let sends=0;
    hub.setPreference('bob',event.project,'telegram',true);hub.publish('bob',event,101);
    await worker.runOnce('alice','telegram',async()=>{sends++;throw new Error('timeout');},()=>100);
    assert.equal(worker.status('alice')[0].state,'uncertain'); assert.equal(worker.status('bob')[0].state,'pending');
    assert.equal(await worker.runOnce('alice','telegram',async()=>{sends++;return 'sent';},()=>900_000),false);
    assert.equal(sends,1);
  } finally {db.close();}
});
