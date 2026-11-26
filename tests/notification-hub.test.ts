import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { NotificationHub, normalizeNotification } from '../server/notificationHub.ts';
const event = {version:1,id:'event1',source:'fixture',project:'demo/project',type:'ci.failed',severity:'critical',timestamp:100,correlation_id:'run1',evidence_url:'https://github.com/demo/project/actions/runs/123'};

test('N1 schema redacts by construction and restricts evidence links', () => {
  assert.equal(normalizeNotification(event).summary,'CI fallita');
  for (const bad of [{...event,summary:'secret'}, {...event,version:2}, {...event,type:'constructor'}, {...event,severity:['critical']}, {...event,evidence_url:'https://github.com/demo/project/issues/1?token=secret'}, {...event,evidence_url:'https://github.com/other/project/issues/1'}, {...event,project:'demo/..'}]) assert.throws(() => normalizeNotification(bad));
});
test('N1 durable deduplication, conflicting payload and tenant isolation', () => {
  const dir=mkdtempSync(join(tmpdir(),'forgia-notify-')); const file=join(dir,'db.sqlite');
  let db=new DatabaseSync(file);
  try {
    let hub=new NotificationHub(db);
    assert.deepEqual(hub.publish('alice',event,101),{duplicate:false});
    assert.equal(hub.markRead('bob','fixture','event1',102),false);
    assert.equal(hub.inbox('bob').length,0);
    assert.equal(hub.markRead('alice','fixture','event1',103),true);
    db.close(); db=new DatabaseSync(file); hub=new NotificationHub(db);
    assert.deepEqual(hub.publish('alice',event,104),{duplicate:true});
    assert.throws(() => hub.publish('alice',{...event,severity:'info'}),/conflict/);
    assert.equal(hub.inbox('alice',null,true).length,0);
    assert.equal(hub.inbox('alice')[0].readAt,103);
    assert.equal(hub.inbox('alice','demo/other').length,0);
    assert.deepEqual(hub.publish('bob',event),{duplicate:false});
    assert.equal(hub.inbox('bob',null,true).length,1);
  } finally {db.close();rmSync(dir,{recursive:true,force:true});}
});
test('N2 no implicit channel, opt-in only future events, revocation is irreversible for queued items', () => {
  const db=new DatabaseSync(':memory:');
  try {
    const hub=new NotificationHub(db);
    hub.publish('alice',event); assert.equal(hub.outbox('alice').length,0);
    hub.setPreference('alice','demo/project','telegram',true);
    hub.publish('alice',event); assert.equal(hub.outbox('alice').length,0);
    const next={...event,id:'event2'};
    hub.publish('alice',next); hub.publish('alice',next); hub.publish('bob',next);
    assert.equal(hub.outbox('alice').length,1); assert.equal(hub.outbox('bob').length,0);
    hub.setPreference('alice','demo/project','telegram',false);
    hub.setPreference('alice','demo/project','telegram',true);
    assert.equal(hub.outbox('alice')[0].state,'revoked');
    hub.publish('alice',{...event,id:'event3'});
    assert.deepEqual(hub.outbox('alice').map(r=>r.state),['revoked','pending']);
  } finally {db.close();}
});
test('N2 inbox and outbox roll back together on enqueue failure', () => {
  const db=new DatabaseSync(':memory:');
  try {
    const hub=new NotificationHub(db); hub.setPreference('alice','demo/project','email',true);
    db.exec("CREATE TRIGGER fail_enqueue BEFORE INSERT ON notification_outbox BEGIN SELECT RAISE(ABORT,'fixture failure'); END");
    assert.throws(() => hub.publish('alice',event),/fixture failure/);
    assert.equal(hub.inbox('alice').length,0); assert.equal(hub.outbox('alice').length,0);
  } finally {db.close();}
});
