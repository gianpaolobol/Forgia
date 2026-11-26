import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { NotificationHub } from '../server/notificationHub.ts';
import { NotificationDigest } from '../server/notificationDigest.ts';
const project='demo/project', DAY=86_400_000, HOUR=3_600_000;
function event(id: string, severity='info', p=project) {
  return {version:1,id,source:'fixture',project:p,type:'task.updated',severity,timestamp:1,correlation_id:id};
}
test('N4 scheduled digest excludes history, isolates owner/project and does not change normal inbox or outbox',()=>{
  const db=new DatabaseSync(':memory:');
  try {
    const h=new NotificationHub(db), d=new NotificationDigest(db);
    h.publish('alice',event('old'),1);
    h.setPreference('alice',project,'email',true);
    d.setSchedule('alice',project,60,2);
    h.publish('alice',event('a','critical'),3);
    h.publish('alice',event('b','warning'),4);
    h.publish('alice',event('c'),5);
    h.publish('bob',event('foreign'),6);
    h.publish('alice',event('foreign','info','demo/other'),6);
    assert.equal(d.tick('alice',project,HOUR-1),null);
    const result=d.tick('alice',project,HOUR);
    assert.deepEqual(result,{slot:HOUR,generatedAt:HOUR,total:3,critical:1,warning:1,info:1,more:false});
    assert.equal(d.tick('alice',project,HOUR),null);
    assert.deepEqual(d.inbox('alice',project),[result]);
    assert.deepEqual(d.inbox('bob',project),[]);
    assert.deepEqual(d.inbox('alice','demo/other'),[]);
    assert.equal(h.inbox('alice',project,true).length,4);
    assert.equal(h.outbox('alice').length,3);
  } finally {db.close();}
});
test('N4 two workers, restart and missed slots coalesce; clock rollback does not reopen a slot',()=>{
  const dir=mkdtempSync(join(tmpdir(),'forgia-digest-')), file=join(dir,'db.sqlite');
  const a=new DatabaseSync(file); let b=new DatabaseSync(file);
  try {
    const h=new NotificationHub(a), d=new NotificationDigest(a);
    let second=new NotificationDigest(b);
    d.setSchedule('alice',project,60,1);
    h.publish('alice',event('first'),2);
    const delayed=3*DAY+HOUR;
    assert.equal(second.tick('alice',project,delayed)?.total,1);
    assert.equal(d.tick('alice',project,delayed),null);
    b.close(); b=new DatabaseSync(file); second=new NotificationDigest(b);
    h.publish('alice',event('second'),delayed+1);
    assert.equal(second.tick('alice',project,HOUR),null);
    assert.throws(()=>d.setSchedule('alice',project,120,HOUR));
    assert.equal(second.tick('alice',project,delayed+DAY)?.total,1);
    assert.equal(d.inbox('alice',project).length,2);
    assert.equal(d.tick('alice',project,delayed+2*DAY),null);
  } finally {a.close();b.close();rmSync(dir,{recursive:true,force:true});}
});
test('N4 revocation, re-enable baseline and input validation; no digest for disabled history',()=>{
  const db=new DatabaseSync(':memory:');
  try {
    const h=new NotificationHub(db), d=new NotificationDigest(db);
    d.setSchedule('alice',project,60,1);
    h.publish('alice',event('before'),2);
    assert.equal(d.tick('alice',project,10),null);
    d.setSchedule('alice',project,null,3); // revocation must work despite clock rollback
    assert.throws(()=>d.setSchedule('alice',project,60,4));
    h.publish('alice',event('disabled'),4);
    assert.equal(d.tick('alice',project,HOUR),null);
    d.setSchedule('alice',project,120,HOUR);
    h.publish('alice',event('new'),HOUR+1);
    assert.equal(d.tick('alice',project,2*HOUR)?.total,1);
    assert.throws(()=>d.setSchedule('alice',project,1440,2*HOUR));
    assert.throws(()=>d.inbox('bad owner',project));
    assert.throws(()=>d.inbox('alice','demo/..'));
    assert.throws(()=>d.inbox('alice',project,101));
  } finally {db.close();}
});
test('N4 bounded batch and pending overflow; future receipt excluded and later collected',()=>{
  const db=new DatabaseSync(':memory:');
  try {
    const h=new NotificationHub(db), d=new NotificationDigest(db);
    d.setSchedule('alice',project,60,1);
    for(let i=0;i<501;i++) h.publish('alice',event('e'+i),2);
    h.publish('alice',event('future'),HOUR+1);
    const first=d.tick('alice',project,HOUR);
    assert.equal(first?.total,500);assert.equal(first?.more,true);
    const next=d.tick('alice',project,DAY+HOUR);
    assert.equal(next?.total,2);assert.equal(next?.more,false);
    assert.equal(d.tick('alice',project,2*DAY+HOUR),null);
  } finally {db.close();}
});
