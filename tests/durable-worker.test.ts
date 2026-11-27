import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync} from 'node:fs';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {setTimeout as delay} from 'node:timers/promises';
import {openJobLedger} from '../server/jobLedger.ts';
import {runOneDurableJob} from '../server/durableWorker.ts';
import {QuotaDeferral} from '../server/quotaDeferral.ts';

const session = '00000000-0000-0000-0000-000000000001';
const payload = JSON.stringify({idea:'Test',provider:'local',consent:false,context:{kind:'catalog',phase:'draft'}});
function fixture(t: {after: (fn: () => void) => void}) {
  const dir = mkdtempSync(join(tmpdir(),'forgia-worker-'));
  const path = join(dir,'jobs.db'), ledger = openJobLedger(path);
  t.after(() => {ledger.close(); rmSync(dir,{recursive:true,force:true});});
  return {ledger,path};
}

test('W1 dispatch marker precedes execution, scoped result survives reopen',async t => {
  const {ledger,path} = fixture(t), id = ledger.enqueue(session,'k',payload);
  let checks = 0;
  const outcome = await runOneDurableJob(ledger,{worker:'w',authorize:async (s,input) => {
    assert.equal(s,session); assert.equal(input.consent,false); assert.equal(ledger.read(id,session)?.status,++checks===1?'claimed':'dispatched'); return true;
  },run:async (input,s,signal) => {
    assert.equal(input.idea,'Test'); assert.equal(s,session); assert.equal(signal.aborted,false);
    assert.equal(ledger.read(id,session)?.status,'dispatched'); return {answer:1};
  }});
  assert.equal(outcome,'done');
  assert.ok(checks>=2);
  const reopened = openJobLedger(path);
  try { assert.deepEqual(JSON.parse(reopened.read(id,session)!.result!),{answer:1}); assert.equal(reopened.read(id,'other'),null); }
  finally {reopened.close();}
  assert.equal(await runOneDurableJob(ledger,{worker:'w',authorize:async()=>true,run:async()=>assert.fail('replay')}),'idle');
});

test('W2 revoked or unavailable authorization fails closed, no invocation',async t => {
  const {ledger} = fixture(t);
  for (const [authorize,code] of [[async()=>false,403],[async()=>{throw Error('secret');},503]] as const) {
    const id = ledger.enqueue(session,null,payload);
    assert.equal(await runOneDurableJob(ledger,{worker:'w',authorize,run:async()=>assert.fail('unauthorized')}),'failed');
    const row = ledger.read(id,session)!;
    assert.equal(row.status,'failed'); assert.equal(row.worker,null);
    assert.equal(JSON.parse(row.result!).statusCode,code); assert.ok(!row.result!.includes('secret'));
  }
});

test('W3 malformed or extra payload fields fail before auth/dispatch',async t => {
  const {ledger} = fixture(t);
  for (const raw of ['{',JSON.stringify({...JSON.parse(payload),extra:true})]) {
    const id = ledger.enqueue(session,null,raw);
    let calls = 0;
    assert.equal(await runOneDurableJob(ledger,{worker:'w',authorize:async()=>{calls++; return true;},run:async()=>{calls++;}}),'failed');
    assert.equal(calls,0); assert.equal(JSON.parse(ledger.read(id,session)!.result!).statusCode,400);
  }
});

test('W4 rejection after dispatch records uncertain and cannot replay',async t => {
  const {ledger} = fixture(t), id = ledger.enqueue(session,'k',payload);
  assert.equal(await runOneDurableJob(ledger,{worker:'w',authorize:async()=>true,run:async()=>{throw Error('secret');}}),'uncertain');
  const row = ledger.read(id,session)!;
  assert.equal(row.status,'uncertain'); assert.equal(row.result,null); assert.equal(row.worker,null);
  assert.equal(ledger.enqueue(session,'k',payload),id); assert.equal(ledger.claim('another',Date.now(),30000),null);
});

test('W5 expired authorization lease cannot dispatch or overwrite new claimant',async t => {
  const {ledger} = fixture(t), id = ledger.enqueue(session,null,payload);
  let time = 100;
  assert.equal(await runOneDurableJob(ledger,{worker:'w',now:()=>time,ttl:30,authorize:async()=>{
    time = 130; assert.equal(ledger.claim('new',time,30)?.worker,'new'); return true;
  },run:async()=>assert.fail('stale worker')}),'lease-lost');
  assert.equal(ledger.read(id,session)?.worker,'new'); assert.equal(ledger.read(id,session)?.fence,2);
});

test('W6 heartbeat renews lease while awaiting runner, second connection cannot claim',async t => {
  const {ledger,path} = fixture(t), id = ledger.enqueue(session,null,payload);
  const other = openJobLedger(path); t.after(()=>other.close());
  let time = 100;
  assert.equal(await runOneDurableJob(ledger,{worker:'w',now:()=>time,ttl:90,authorize:async()=>true,run:async()=>{
    time = 140;
    await delay(45);
    assert.equal(other.read(id,session)?.expires,230);
    time = 200; assert.equal(other.claim('new',time,90),null); return {ok:true};
  }}),'done');
});

test('W7 execution deadline aborts cooperative runner, no automatic retry',async t => {
  const {ledger} = fixture(t), id = ledger.enqueue(session,null,payload);
  let aborted = false;
  assert.equal(await runOneDurableJob(ledger,{worker:'w',maxRunMs:20,authorize:async()=>true,run:async(_input,_session,signal)=>new Promise(resolve=>{
    signal.addEventListener('abort',()=>{aborted=true; resolve({late:true});},{once:true});
  })}),'uncertain');
  assert.equal(aborted,true); assert.equal(ledger.read(id,session)?.status,'uncertain');
});

test('W8 authorization deadline does not leave caller blocked or dispatch',async t => {
  const {ledger} = fixture(t), id = ledger.enqueue(session,null,payload);
  assert.equal(await runOneDurableJob(ledger,{worker:'w',ttl:30,now:()=>100,authorize:()=>new Promise(()=>{}),run:async()=>assert.fail('unauthorized')}),'failed');
  assert.equal(JSON.parse(ledger.read(id,session)!.result!).statusCode,503);
});

test('W9 lease loss after dispatch aborts runner and cannot write a late result',async t => {
  const {ledger,path} = fixture(t), id = ledger.enqueue(session,null,payload);
  const other = openJobLedger(path); t.after(()=>other.close());
  let time = 100, aborted = false;
  assert.equal(await runOneDurableJob(ledger,{worker:'w',ttl:30,now:()=>time,authorize:async()=>true,run:async(_input,_session,signal)=>new Promise(resolve=>{
    signal.addEventListener('abort',()=>{aborted=true; resolve({late:true});},{once:true});
    time = 130; assert.equal(other.recoverExpired(time).uncertain,1);
  })}),'lease-lost');
  assert.equal(aborted,true); assert.equal(ledger.read(id,session)?.status,'uncertain'); assert.equal(ledger.read(id,session)?.result,null);
});

test('W10 live revocation aborts a dispatched job without publishing or replay',async t => {
  const {ledger}=fixture(t), id=ledger.enqueue(session,'live',payload);
  let valid=true, aborted=false;
  const outcome=await runOneDurableJob(ledger,{worker:'w',ttl:90,maxRunMs:2000,authorize:async()=>valid,run:async(_input,_session,signal)=>new Promise(resolve=>{
    signal.addEventListener('abort',()=>{aborted=true; resolve({late:true});},{once:true});
    valid=false;
  })});
  assert.equal(outcome,'uncertain');
  assert.equal(aborted,true);
  assert.equal(ledger.read(id,session)?.result,null);
  assert.equal(ledger.enqueue(session,'live',payload),id);
  assert.equal(ledger.claim('new',Date.now(),30000),null);
});

test('W11 final authorization rejects a result revoked before the first poll',async t => {
  const {ledger}=fixture(t), id=ledger.enqueue(session,null,payload);
  let valid=true;
  assert.equal(await runOneDurableJob(ledger,{worker:'w',authorize:async()=>valid,run:async()=>{valid=false;return {privateResult:true};}}),'uncertain');
  assert.equal(ledger.read(id,session)?.result,null);
});

test('W12 a quota refusal cannot schedule a retry after authorization is revoked',async t => {
  const {ledger}=fixture(t), id=ledger.enqueue(session,null,payload);
  let valid=true;
  assert.equal(await runOneDurableJob(ledger,{worker:'w',authorize:async()=>valid,run:async()=>{valid=false;throw new QuotaDeferral(Date.now()+120000);}}),'uncertain');
  assert.equal(ledger.deferredUntil(id),undefined);
  assert.equal(ledger.claim('new',Date.now()+180000,30000),null);
});

test('W13 an unavailable final authorization cannot publish a result',async t => {
  const {ledger}=fixture(t), id=ledger.enqueue(session,null,payload);
  let dispatched=false;
  assert.equal(await runOneDurableJob(ledger,{worker:'w',ttl:90,authorize:async()=>{if(dispatched)throw Error('private');return true;},run:async()=>{dispatched=true;return {secret:'private'};}}),'uncertain');
  assert.equal(ledger.read(id,session)?.result,null);
});
