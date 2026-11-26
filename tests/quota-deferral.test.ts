import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {openJobLedger} from '../server/jobLedger.ts';
import {runOneDurableJob} from '../server/durableWorker.ts';
import {QuotaDeferral, ProviderError, retryDeadline, nextUtcDay, MAX_RETRY_DEADLINE} from '../server/quotaDeferral.ts';

const session='00000000-0000-0000-0000-000000000001';
const payload=JSON.stringify({idea:'Test quota',provider:'local',consent:false,context:{kind:'catalog',phase:'draft'}});
test('S1 Retry-After delta, HTTP date, invalid and huge values never shorten a known deadline',()=>{
  const now=Date.UTC(2026,10,25,14,0,0);
  assert.equal(retryDeadline('120',now),now+120000);
  assert.equal(retryDeadline(new Date(now+300000).toUTCString(),now),now+300000);
  for(const header of [null,'-1','foo','3.2','0','10']) assert.equal(retryDeadline(header,now),now+60000);
  assert.equal(retryDeadline('99999999999999999999999',now),MAX_RETRY_DEADLINE);
  assert.equal(nextUtcDay(now),Date.UTC(2026,10,26));
  assert.throws(()=>retryDeadline(null,NaN));
});
test('S2 persisted deferral, exclusive deadline and authorization recheck after reopen',async t=>{
  const dir=mkdtempSync(join(tmpdir(),'forgia-deferral-'));
  const path=join(dir,'jobs.db');let db=openJobLedger(path);
  t.after(()=>{db.close();rmSync(dir,{recursive:true,force:true});});
  let now=100000,calls=0,checks=0;
  const id=db.enqueue(session,'same',payload);
  const run=()=>runOneDurableJob(db,{worker:'w',now:()=>now,authorize:async()=>{checks++;return checks===1;},run:async()=>{calls++;throw new QuotaDeferral(now+120000);}});
  assert.equal(await run(),'deferred');assert.equal(db.deferredUntil(id),220000);
  db.close();db=openJobLedger(path);
  const other=openJobLedger(path);
  try {assert.equal(other.claim('other',219999,30000),null);assert.equal(other.enqueue(session,'same',payload),id);} finally{other.close();}
  now=219999;assert.equal(await run(),'idle');
  now=220000;assert.equal(await run(),'failed');assert.equal(calls,1);assert.equal(checks,2);
  assert.equal(JSON.parse(db.read(id,session)!.result!).statusCode,403);
});
test('S3 bounded retries and ambiguous errors cannot replay',async t=>{
  const dir=mkdtempSync(join(tmpdir(),'forgia-deferral-cap-'));
  const db=openJobLedger(join(dir,'jobs.db'));t.after(()=>{db.close();rmSync(dir,{recursive:true,force:true});});
  let now=100000, calls=0;
  const id=db.enqueue(session,'cap',payload);
  const run=()=>runOneDurableJob(db,{worker:'w',now:()=>now,authorize:async()=>true,run:async()=>{calls++;throw new QuotaDeferral(now+60000);}});
  assert.equal(await run(),'deferred');now+=60000;
  assert.equal(await run(),'deferred');now+=60000;
  assert.equal(await run(),'failed');assert.equal(calls,3);
  assert.equal(JSON.parse(db.read(id,session)!.result!).statusCode,429);
  const other=db.enqueue(session,'unknown',payload);
  assert.equal(await runOneDurableJob(db,{worker:'w',now:()=>now,authorize:async()=>true,run:async()=>{throw new ProviderError('unknown effect',429);}}),'uncertain');
  assert.equal(db.read(other,session)?.status,'uncertain');
  now+=60000;assert.equal(db.claim('other',now,30000),null);
});
test('S3 stale lease cannot defer or change uncertain outcome',t=>{
  const dir=mkdtempSync(join(tmpdir(),'forgia-deferral-fence-'));
  const db=openJobLedger(join(dir,'jobs.db'));t.after(()=>{db.close();rmSync(dir,{recursive:true,force:true});});
  const id=db.enqueue(session,'stale',payload);
  const row=db.claim('w',100,30)!;const lease={id,worker:'w',fence:row.fence};
  assert.equal(db.markDispatched(lease,100),true);
  assert.equal(db.recoverExpired(130).uncertain,1);
  assert.equal(db.deferQuota(lease,130,60130),'lease-lost');
  assert.equal(db.read(id,session)?.status,'uncertain');
});

test('S4 provider cooldown shared across connections, survives reopen without shortening',t=>{
  const dir=mkdtempSync(join(tmpdir(),'forgia-cooldown-'));
  const path=join(dir,'jobs.db');const db=openJobLedger(path);
  t.after(()=>{db.close();rmSync(dir,{recursive:true,force:true});});
  db.recordLocalCooldown('local',220000);db.recordLocalCooldown('local',160000);
  const second=openJobLedger(path);
  try {assert.equal(second.localCooldownUntil('local'),220000);assert.equal(second.localCooldownUntil('llamacpp'),0);second.recordLocalCooldown('local',280000);}
  finally {second.close();}
  assert.equal(db.localCooldownUntil('local'),280000);
  assert.throws(()=>db.recordLocalCooldown('groq',1));
  assert.throws(()=>db.recordLocalCooldown('local',NaN));
});
