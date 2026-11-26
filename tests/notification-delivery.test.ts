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

test('N2 quiet hours UTC wrap midnight, critical bypass, ordinary event deferred without attempt',()=>{
  const db=new DatabaseSync(':memory:');
  try {
    const hub=new NotificationHub(db), worker=new NotificationDelivery(db);
    hub.setPreference('alice',event.project,'telegram',true);
    hub.publish('alice',{...event,id:'ordinary',severity:'info'},1);
    hub.publish('alice',{...event,id:'critical'},2);
    worker.setPolicy('alice','telegram',{quietStartUtcMinute:1320,quietEndUtcMinute:420,minGapMs:1000});
    const night=23*3600000;
    const c=worker.claim('alice','telegram',night)!;
    assert.equal(c.id,'critical');
    assert.ok(worker.begin(c,night)); assert.ok(worker.finish(c,'sent',night));
    assert.equal(worker.claim('alice','telegram',24*3600000+6*3600000),null);
    assert.equal(worker.status('alice').find(r=>r.id==='ordinary')?.attempts,0);
    const morning=31*3600000;
    const next=worker.claim('alice','telegram',morning)!;
    assert.equal(next.id,'ordinary'); assert.ok(worker.begin(next,morning));
  } finally {db.close();}
});
test('N2 persistent dispatch pacing across workers, restart and clock rollback',()=>{
  const dir=mkdtempSync(join(tmpdir(),'forgia-pace-')); const file=join(dir,'db.sqlite');
  const a=new DatabaseSync(file); let b=new DatabaseSync(file);
  try {
    const {hub,worker}=fixture(a); let second=new NotificationDelivery(b);
    hub.publish('alice',{...event,id:'event2'},102);
    hub.setPreference('bob',event.project,'telegram',true); hub.publish('bob',event,101);
    worker.setPolicy('alice','telegram',{quietStartUtcMinute:null,quietEndUtcMinute:null,minGapMs:5000});
    const first=worker.claim('alice','telegram',10000)!;
    const other=second.claim('alice','telegram',10000)!;
    assert.ok(worker.begin(first,10000)); assert.ok(worker.finish(first,'sent',10001));
    assert.equal(second.begin(other,10001),null);
    assert.equal(second.status('alice').find(r=>r.id==='event2')?.attempts,0);
    b.close(); b=new DatabaseSync(file); second=new NotificationDelivery(b);
    assert.equal(second.claim('alice','telegram',9000),null);
    assert.equal(second.claim('alice','telegram',14999),null);
    const separate=second.claim('bob','telegram',10001)!;
    assert.ok(second.begin(separate,10001)); assert.ok(second.finish(separate,'sent',10002));
    const next=second.claim('alice','telegram',15000)!;
    assert.equal(next.id,'event2'); assert.ok(second.begin(next,15000));
  } finally {a.close();b.close();rmSync(dir,{recursive:true,force:true});}
});
test('N2 policy change after claim rechecks quiet hours; invalid policy rejected; revocation wins',()=>{
  const db=new DatabaseSync(':memory:');
  try {
    const hub=new NotificationHub(db), worker=new NotificationDelivery(db);
    hub.setPreference('alice',event.project,'email',true);
    hub.publish('alice',{...event,severity:'info'},101);
    const now=8*3600000, c=worker.claim('alice','email',now)!;
    for(const p of [
      {quietStartUtcMinute:1,quietEndUtcMinute:null,minGapMs:1000},
      {quietStartUtcMinute:1,quietEndUtcMinute:1,minGapMs:1000},
      {quietStartUtcMinute:null,quietEndUtcMinute:null,minGapMs:0},
    ]) assert.throws(()=>worker.setPolicy('alice','email',p));
    worker.setPolicy('alice','email',{quietStartUtcMinute:480,quietEndUtcMinute:540,minGapMs:1000});
    assert.equal(worker.begin(c,now),null);
    assert.equal(worker.status('alice')[0].attempts,0);
    worker.setPolicy('alice','email',{quietStartUtcMinute:null,quietEndUtcMinute:null,minGapMs:1000});
    const next=worker.claim('alice','email',now)!;
    hub.setPreference('alice',event.project,'email',false);
    assert.equal(worker.begin(next,now),null);
    assert.equal(worker.status('alice')[0].state,'revoked');
  } finally {db.close();}
});
