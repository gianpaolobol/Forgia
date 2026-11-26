import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { NotificationHub } from '../server/notificationHub.ts';
import { NotificationDelivery } from '../server/notificationDelivery.ts';
import { ingestGithubRun } from '../server/notificationGithubIngress.ts';

const now=Date.parse('2026-11-26T10:00:00Z');
const scope={owner:'alice',project:'demo/project',repositoryId:12,workflowId:34};
const key=Buffer.alloc(32,7); // fixture only
const fixture=()=>({action:'completed',repository:{id:12,full_name:'demo/project'},
  workflow_run:{id:56,run_attempt:1,workflow_id:34,status:'completed',conclusion:'failure',
    updated_at:'2026-11-26T09:59:00Z',display_title:'PRIVATE_FIXTURE',html_url:'https://invalid.example/private'}});
const encode=(v: unknown)=>Buffer.from(JSON.stringify(v));
const sign=(b: Buffer)=>'sha256='+createHmac('sha256',key).update(b).digest('hex');
function ingest(hub: NotificationHub, v: unknown, at=now) {
  const b=encode(v); return ingestGithubRun(hub,scope,key,b,sign(b),at);
}

test('N3 signed GitHub event reaches scoped inbox, opt-in outbox and synthetic worker', async () => {
  const db=new DatabaseSync(':memory:');
  try {
    const hub=new NotificationHub(db), worker=new NotificationDelivery(db);
    hub.setPreference('alice',scope.project,'telegram',true);
    assert.deepEqual(ingest(hub,fixture()),{duplicate:false});
    const events=hub.inbox('alice');
    assert.equal(events.length,1); assert.equal(events[0].event.type,'ci.failed');
    assert.equal(events[0].event.evidence_url,'https://github.com/demo/project/actions/runs/56');
    assert.ok(!JSON.stringify(events).includes('PRIVATE_FIXTURE'));
    assert.equal(hub.inbox('bob').length,0); assert.equal(hub.outbox('bob').length,0);
    let calls=0;
    assert.equal(await worker.runOnce('alice','telegram',async d=>{calls++;assert.equal(d.event.id,'run-56-attempt-1');return 'sent';},()=>now),true);
    assert.deepEqual(ingest(hub,fixture()),{duplicate:true});
    assert.equal(await worker.runOnce('alice','telegram',async()=>{calls++;return 'sent';},()=>now+1000),false);
    assert.equal(calls,1); assert.equal(worker.status('alice')[0].state,'sent');
  } finally { db.close(); }
});
test('N3 rejects tampering, malformed signature, oversized body and wrong scope before publication', () => {
  const db=new DatabaseSync(':memory:');
  try {
    const hub=new NotificationHub(db), b=encode(fixture());
    const altered=Buffer.concat([b,Buffer.from(' ')]);
    assert.throws(()=>ingestGithubRun(hub,scope,key,altered,sign(b),now),/signature/);
    assert.throws(()=>ingestGithubRun(hub,scope,key,b,'sha256=00',now),/signature/);
    const large=Buffer.alloc(1024*1024+1);
    assert.throws(()=>ingestGithubRun(hub,scope,key,large,sign(large),now),/body/);
    for (const v of [
      {...fixture(),repository:{id:13,full_name:scope.project}},
      {...fixture(),repository:{id:12,full_name:'other/project'}},
      {...fixture(),workflow_run:{...fixture().workflow_run,workflow_id:35}},
      {...fixture(),action:'requested'},
      {...fixture(),workflow_run:{...fixture().workflow_run,repository:{id:13,full_name:scope.project}}},
      {...fixture(),workflow_run:{...fixture().workflow_run,conclusion:'cancelled'}},
    ]) assert.throws(()=>ingest(hub,v));
    assert.equal(hub.inbox('alice').length,0);
  } finally { db.close(); }
});
test('N3 replay survives database reopen, opt-in does not resurrect and rerun is distinct', () => {
  const dir=mkdtempSync(join(tmpdir(),'forgia-github-ingress-')), file=join(dir,'db.sqlite');
  let db=new DatabaseSync(file);
  try {
    let hub=new NotificationHub(db);
    ingest(hub,fixture()); db.close(); db=new DatabaseSync(file); hub=new NotificationHub(db);
    hub.setPreference('alice',scope.project,'email',true);
    assert.deepEqual(ingest(hub,fixture()),{duplicate:true}); assert.equal(hub.outbox('alice').length,0);
    assert.throws(()=>ingest(hub,{...fixture(),workflow_run:{...fixture().workflow_run,conclusion:'success'}}),/conflict/);
    const next={...fixture(),workflow_run:{...fixture().workflow_run,run_attempt:2,conclusion:'success'}};
    assert.deepEqual(ingest(hub,next),{duplicate:false});
    assert.equal(hub.inbox('alice').length,2); assert.equal(hub.outbox('alice').length,1);
  } finally { db.close(); rmSync(dir,{recursive:true,force:true}); }
});
test('N3 rejects stale, future, impossible dates and malformed JSON', () => {
  const db=new DatabaseSync(':memory:');
  try {
    const hub=new NotificationHub(db);
    for (const updated_at of ['2026-11-24T10:00:00Z','2026-11-26T10:02:00Z','2026-02-30T10:00:00Z'])
      assert.throws(()=>ingest(hub,{...fixture(),workflow_run:{...fixture().workflow_run,updated_at}}),/timestamp/);
    const bad=Buffer.from('{PRIVATE_FIXTURE');
    assert.throws(()=>ingestGithubRun(hub,scope,key,bad,sign(bad),now),{message:'Invalid GitHub event'});
    assert.equal(hub.inbox('alice').length,0);
  } finally { db.close(); }
});
