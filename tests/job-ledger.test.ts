import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {openJobLedger} from '../server/jobLedger.ts';

function fixture(t: {after: (fn: () => void) => void}) {
  const dir = mkdtempSync(join(tmpdir(),'forgia-ledger-'));
  const path = join(dir,'jobs.sqlite');
  const a = openJobLedger(path), b = openJobLedger(path);
  t.after(() => {a.close(); b.close(); rmSync(dir,{recursive:true,force:true});});
  return {a,b,path};
}
const lease = (row: NonNullable<ReturnType<ReturnType<typeof openJobLedger>['claim']>>) => ({id:row.id,fence:row.fence,worker:row.worker!});
test('atomic claim across two connections and session isolation', t => {
  const {a,b} = fixture(t); const id = a.enqueue('s','k','{}');
  assert.equal(b.enqueue('s','k','{}'),id); assert.equal(b.read(id,'other'),null);
  const row = a.claim('a',100,50)!; assert.equal(row.id,id); assert.equal(b.claim('b',100,50),null);
  assert.equal(a.markDispatched(lease(row),101),true); assert.equal(a.finish(lease(row),102,'done','ok'),true);
  assert.equal(b.read(id,'s')?.result,'ok'); assert.equal(b.enqueue('s','k','{}'),id);
});
test('dedup conflict and same key in different session', t => {
  const {a,b}=fixture(t); const id=a.enqueue('s','k','x');
  assert.throws(()=>b.enqueue('s','k','y'),{status:409}); assert.notEqual(b.enqueue('t','k','y'),id);
});
test('expired undispatched claim is reclaimed with fencing', t => {
  const {a,b}=fixture(t); a.enqueue('s',null,'x');
  const first=lease(a.claim('a',100,10)!); const second=lease(b.claim('b',110,10)!);
  assert.equal(first.id,second.id); assert.equal(second.fence,first.fence+1);
  assert.equal(a.markDispatched(first,111),false); assert.equal(b.markDispatched(second,111),true);
  assert.equal(a.finish(first,112,'done','stale'),false); assert.equal(b.finish(second,112,'done','new'),true);
});
test('expired dispatched job never replayed even after reopen', t => {
  const {a,b,path}=fixture(t); const id=a.enqueue('s','k','x'); const l=lease(a.claim('a',100,10)!);
  assert.equal(a.markDispatched(l,101),true); const reopened=openJobLedger(path);
  try {assert.equal(reopened.claim('c',110,10),null); assert.equal(reopened.read(id,'s')?.status,'uncertain'); assert.equal(reopened.enqueue('s','k','x'),id);} finally {reopened.close();}
  assert.equal(b.finish(l,111,'done','late'),false);
});
test('heartbeat cannot shorten lease or revive expiry', t => {
  const {a,b}=fixture(t); a.enqueue('s',null,'x'); const l=lease(a.claim('a',100,20)!);
  assert.equal(a.heartbeat(l,105,5),true); assert.equal(b.claim('b',110,20),null);
  assert.equal(a.heartbeat(l,115,20),true); assert.equal(b.claim('b',120,20),null);
  assert.equal(a.heartbeat(l,135,20),false); assert.ok(b.claim('b',135,20));
});
test('queue caps are shared by connections', t => {
  const {a,b}=fixture(t); for(let i=0;i<3;i++) a.enqueue('s',null,String(i));
  assert.throws(()=>b.enqueue('s',null,'4'),{status:429});
  for(let i=0;i<13;i++) b.enqueue('other'+i,null,'x');
  assert.throws(()=>a.enqueue('last',null,'x'),{status:429});
});
test('cannot finish before dispatch or twice', t => {
  const {a}=fixture(t); a.enqueue('s',null,'x'); const l=lease(a.claim('a',100,10)!);
  assert.equal(a.finish(l,101,'done','bad'),false); assert.equal(a.markDispatched(l,101),true);
  assert.equal(a.markDispatched(l,102),false); assert.equal(a.finish(l,102,'failed','err'),true);
  assert.equal(a.finish(l,103,'done','bad'),false);
});
