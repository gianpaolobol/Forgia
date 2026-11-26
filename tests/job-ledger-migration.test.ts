import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {randomUUID} from 'node:crypto';
import {openJobLedger} from '../server/jobLedger.ts';

const session = randomUUID(), other = randomUUID();
const input = {idea:'Catalogo',provider:'auto',consent:false,context:{kind:'catalog',phase:'draft'}};
const job = (requestKey: string, owner = session) => ({id:randomUUID(),session:owner,requestKey,status:'queued',input});
function fixture(t: {after: (fn: () => void) => void}) {
  const dir = mkdtempSync(join(tmpdir(),'forgia-migration-'));
  const path = join(dir,'jobs.sqlite');
  const a = openJobLedger(path), b = openJobLedger(path);
  t.after(() => {a.close(); b.close(); rmSync(dir,{recursive:true,force:true});});
  return {a,b,path};
}
test('preserve IDs, scope, input, results; running never replays', t => {
  const {a,b} = fixture(t);
  const queued = job('q'), running = {...job('r'),status:'running'};
  const done = {id:randomUUID(),session:other,requestKey:'d',status:'done',result:{spec:{name:'Test'}}};
  const failed = {id:randomUUID(),session:other,requestKey:'f',status:'failed',error:'Quota',statusCode:429};
  const raw = JSON.stringify([queued,running,done,failed]);
  assert.equal(a.importLegacy(raw).imported,4);
  assert.equal(b.read(queued.id,other),null);
  assert.deepEqual(JSON.parse(b.read(queued.id,session)!.payload),input);
  assert.equal(b.read(running.id,session)?.status,'uncertain');
  assert.deepEqual(JSON.parse(b.read(done.id,other)!.result!),done.result);
  assert.deepEqual(JSON.parse(b.read(failed.id,other)!.result!),{error:'Quota',statusCode:429});
  assert.equal(b.claim('w',1,100)?.id,queued.id);
  assert.equal(b.claim('w',1,100),null);
  assert.equal(b.enqueue(session,'q',JSON.stringify(input)),queued.id);
  assert.equal(b.enqueue(session,'r',JSON.stringify(input)),running.id);
  assert.throws(()=>b.enqueue(session,'q',JSON.stringify({...input,consent:true})),{status:409});
  assert.throws(()=>b.enqueue(other,'d',JSON.stringify(input)),{status:409});
  assert.throws(()=>b.enqueue(other,'f',JSON.stringify(input)),{status:409});
  assert.throws(()=>b.enqueue(other,'f',''));
});
test('same snapshot idempotent across reopen, different digest rejected', t => {
  const {a,path}=fixture(t); const entry=job('one'); const raw=JSON.stringify([entry]);
  const first=a.importLegacy(raw); const reopened=openJobLedger(path);
  try {
    assert.deepEqual(reopened.importLegacy(raw),{...first,alreadyImported:true});
    assert.throws(()=>reopened.importLegacy(raw+' '),/digest diverso/);
    assert.equal(reopened.claim('w',1,100)?.id,entry.id);
    assert.equal(reopened.importLegacy(raw).alreadyImported,true);
    assert.equal(reopened.claim('w',1,100),null);
  } finally {reopened.close();}
});
test('duplicate legacy keys and IDs rollback completely, corrected snapshot can import', t => {
  const {a,b}=fixture(t); const entry=job('one');
  assert.throws(()=>a.importLegacy(JSON.stringify([entry,job('one')])));
  assert.equal(b.read(entry.id,session),null);
  assert.throws(()=>a.importLegacy(JSON.stringify([entry,{...entry,requestKey:'two'}])));
  assert.equal(b.read(entry.id,session),null);
  assert.equal(b.importLegacy(JSON.stringify([entry])).imported,1);
});
test('invalid or unknown fields do not partially migrate or elevate consent', t => {
  const {a,b}=fixture(t); const entry=job('one'); const second=job('two');
  for(const bad of [{...second,input:{...input,consent:'true'}},{...second,input:{...input,provider:'unknown'}},
    {...second,input:{...input,context:{kind:'catalog',phase:'unknown'}}},{...second,extra:true},
    {...second,status:'done',input:undefined},{...second,status:'failed',input:undefined,error:'x',statusCode:200}]) {
    assert.throws(()=>a.importLegacy(JSON.stringify([entry,bad])));
    assert.equal(b.read(entry.id,session),null);
  }
  assert.throws(()=>a.importLegacy('[broken'));
  assert.equal(a.importLegacy(JSON.stringify([entry])).imported,1);
});
test('nonempty destination and historical caps fail closed', t => {
  const {a,b}=fixture(t);
  assert.throws(()=>a.importLegacy(JSON.stringify(Array.from({length:4},(_,i)=>job(String(i))))));
  assert.throws(()=>a.importLegacy(JSON.stringify(Array.from({length:17},(_,i)=>job(String(i),randomUUID())))));
  const id=b.enqueue(session,'fresh','{}');
  assert.throws(()=>a.importLegacy(JSON.stringify([job('old')])),/Destinazione non vuota/);
  assert.equal(b.read(id,session)?.status,'queued');
});
test('empty snapshot is a durable one-shot cutover marker', t => {
  const {a,b}=fixture(t);
  assert.equal(a.importLegacy('[]').imported,0);
  assert.equal(b.importLegacy('[]').alreadyImported,true);
  assert.throws(()=>b.importLegacy(JSON.stringify([job('late')])),/digest diverso/);
});
