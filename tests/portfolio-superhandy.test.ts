import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {portfolioSuperhandyBaseline} from '../server/portfolioSuperhandy.ts';
import {openSuperhandyLedger} from '../server/superhandyLedger.ts';
import {runLocalSpec,resumeLocalSpec} from '../server/superhandyBridge.ts';

const source = [
  '## 0. Direttive', '## 1. Primo', '**Priorità: P0**',
  'Repository: [https://github.com/test/first](https://github.com/test/first)',
  '1. Milestone privata', '## 2. Altro referente', 'Repository: https://github.com/test/second',
  'Non modificare contemporaneamente il branch assegnato.', '## 3. Sospeso',
  '**Priorità: P3 temporaneamente sospesa**', 'Repository: https://github.com/test/third',
  '## 4. Senza repo', '## 5. REPOSITORY AUSILIARIE',
].join('\n');
const roles = {planner:'planner', reviewer:'reviewer', executors:['one','two']};
const digest = (s:string) => createHash('sha256').update(s).digest('hex');

test('I1 deterministic baseline binds source digest and exact project; no raw milestone execution', () => {
  const plan = portfolioSuperhandyBaseline(source,'portfolio-01',roles);
  assert.deepEqual(plan,portfolioSuperhandyBaseline(source,'portfolio-01',roles));
  assert.equal(plan.project,'portfolio-01');
  assert.equal(plan.tasks.length,3);
  assert.ok(plan.tasks.every(t=>t.criterion.includes(digest(source))&&t.criterion.includes('https://github.com/test/first')));
  assert.doesNotMatch(JSON.stringify(plan),/Milestone privata|test\/second/);
  assert.notDeepEqual(plan,portfolioSuperhandyBaseline(source+'\nchanged','portfolio-01',roles));
});

test('I2 reject external, paused, absent, missing and ambiguous repository or invalid roles', () => {
  for(const id of ['portfolio-02','portfolio-03','portfolio-04','portfolio-05','portfolio-99']) assert.throws(()=>portfolioSuperhandyBaseline(source,id,roles));
  assert.throws(()=>portfolioSuperhandyBaseline(source.replace('https://github.com/test/first)','https://github.com/test/other)'),'portfolio-01',roles),/ambiguo/);
  assert.throws(()=>portfolioSuperhandyBaseline(source.replace('](https://github.com/test/first)', '/tree/main](https://github.com/test/first/tree/main)'),'portfolio-01',roles),/ambiguo/);
  assert.throws(()=>portfolioSuperhandyBaseline(source.replace('1. Milestone privata','Repository: https://github.com/test/other'),'portfolio-01',roles),/ambiguo/);
  assert.throws(()=>portfolioSuperhandyBaseline(source,'portfolio-01',{...roles,reviewer:'one'}));
  assert.throws(()=>portfolioSuperhandyBaseline(source+'x'.repeat(1024*1024),'portfolio-01',roles),/grande/);
});

test('I3 SQLite review gate, DAG dependencies, restart, evidence and reviewer continuity', () => {
  const dir=mkdtempSync(join(tmpdir(),'forgia-portfolio-'));
  const path=join(dir,'ledger.sqlite');
  let ledger=openSuperhandyLedger(path,true);
  try {
    const plan=portfolioSuperhandyBaseline(source,'portfolio-01',roles);
    const sha=ledger.install(plan);
    assert.throws(()=>ledger.claim('one'));
    assert.throws(()=>ledger.approve('one',sha,digest('bad')));
    ledger.approve('reviewer',sha,digest('plan review fixture'));
    assert.equal(ledger.claim('one',60000,'portfolio-evidence'),null);
    const first=ledger.claim('one')!;
    assert.equal(first.task.id,'portfolio-inventory');
    assert.equal(ledger.claim('two'),null);
    ledger.dispatch(first.lease);ledger.submit(first.lease,digest('inventory fixture'));
    ledger.close();ledger=openSuperhandyLedger(path);
    assert.equal(ledger.inspect().baselineSha,sha);
    assert.equal(ledger.claim('two'),null);
    assert.throws(()=>ledger.review('one',first.task.id,digest('inventory fixture'),'accept',digest('review')));
    ledger.review('reviewer',first.task.id,digest('inventory fixture'),'accept',digest('review'));
    const second=ledger.claim('two')!;
    assert.equal(second.task.id,'portfolio-requirements');
    ledger.dispatch(second.lease);ledger.submit(second.lease,digest('requirements fixture'));
    ledger.review('reviewer',second.task.id,digest('requirements fixture'),'accept',digest('review'));
    assert.equal(ledger.claim('one')!.task.id,'portfolio-evidence');
  } finally {ledger.close();rmSync(dir,{recursive:true,force:true});}
});

test('I4 portfolio tasks cannot be run or resumed by AppSpec bridge; no transport or claim', async () => {
  const fail=()=>{throw Error('unexpected side effect');};
  const options={actor:'one',taskId:'portfolio-inventory',artifactDir:'/nonexistent',verifySpec:fail,transport:fail};
  await assert.rejects(runLocalSpec({claim:fail,dispatch:fail,recordReceipt:fail,submit:fail,inspect:fail},{...options,provider:'local'}),/riconciliazione/);
  await assert.rejects(resumeLocalSpec({inspect:fail,reconcile:fail},options),/riconciliazione/);
});
