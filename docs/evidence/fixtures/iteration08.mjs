// Standalone feasibility fixture, not application code. Synthetic time and receipts.
import { DatabaseSync } from 'node:sqlite';
import { spawn } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import assert from 'node:assert/strict';
const open = path => { const db = new DatabaseSync(path); db.exec('PRAGMA busy_timeout=5000; PRAGMA foreign_keys=ON'); return db; };
function tx(db, fn) { db.exec('BEGIN IMMEDIATE'); try { const r=fn(); db.exec('COMMIT'); return r; } catch(e) { db.exec('ROLLBACK'); throw e; } }
function reap(db, now, crash=false) { return tx(db,()=>{
  const rows=db.prepare("SELECT id,fence FROM jobs WHERE state='claimed' AND lease<=?").all(now);
  for(const {id,fence} of rows) {
    assert.equal(db.prepare("UPDATE reservations SET state='released' WHERE job=? AND fence=? AND state='reserved'").run(id,fence).changes,1);
    if(crash) process.exit(41);
    assert.equal(db.prepare("UPDATE jobs SET state='queued',lease=0 WHERE id=? AND fence=? AND state='claimed'").run(id,fence).changes,1);
  }
  return rows.length;
}); }
function claim(db, now, until, bucket) { return tx(db,()=>{
  assert.ok(until>now);
  const q=db.prepare("SELECT cap,(SELECT count(*) FROM reservations WHERE bucket=? AND state IN ('reserved','spent')) AS used FROM buckets WHERE id=?").get(bucket,bucket);
  const job=db.prepare("SELECT id,fence FROM jobs WHERE state='queued' ORDER BY id LIMIT 1").get();
  if(!q || q.used>=q.cap || !job) return null;
  const fence=job.fence+1;
  db.prepare("UPDATE jobs SET state='claimed',fence=?,lease=? WHERE id=?").run(fence,until,job.id);
  db.prepare("INSERT INTO reservations VALUES(?,?,?,'reserved')").run(job.id,fence,bucket);
  return {id:job.id,fence};
}); }
function mark(db,id,fence,now) { return tx(db,()=>{
  const n=db.prepare("UPDATE jobs SET state='effect_pending' WHERE id=? AND fence=? AND state='claimed' AND lease>?").run(id,fence,now).changes;
  if(n) assert.equal(db.prepare("UPDATE reservations SET state='spent' WHERE job=? AND fence=? AND state='reserved'").run(id,fence).changes,1);
  return n;
}); }
const heartbeat=(db,id,fence,now,until)=>db.prepare("UPDATE jobs SET lease=? WHERE id=? AND fence=? AND state IN ('claimed','effect_pending') AND lease>? AND ?>lease").run(until,id,fence,now,until).changes;
const finish=(db,id,fence,now)=>db.prepare("UPDATE jobs SET state='done' WHERE id=? AND fence=? AND state='effect_pending' AND lease>?").run(id,fence,now).changes;
// This is a test stand-in for an authenticated, audited reconciliation authority.
// A real receipt format, validation and operator permission are intentionally not implemented here.
function reconcile(db,id,fence,now,receipt) { return tx(db,()=>{
  if(receipt !== 'synthetic-verified-success') return 0;
  return db.prepare("UPDATE jobs SET state='done_reconciled' WHERE id=? AND fence=? AND state='effect_pending' AND lease<=?").run(id,fence,now).changes;
}); }
if(process.argv[2]) {
  const [mode,path]=process.argv.slice(2); const db=open(path);
  if(mode==='reap-crash') reap(db,10,true);
  if(mode==='reap') console.log(reap(db,10));
  if(mode==='mark') console.log(mark(db,1,1,10));
  if(mode==='claim') console.log(JSON.stringify(claim(db,10,20,'A')));
  db.close();
} else {
  const dir=mkdtempSync(join(tmpdir(),'forgia-08-')); const path=join(dir,'probe.sqlite'); let db=open(path);
  const child=mode=>new Promise((resolve,reject)=>{
    const p=spawn(process.execPath,['--experimental-sqlite',fileURLToPath(import.meta.url),mode,path],{stdio:['ignore','pipe','pipe']});
    let out='',err=''; p.stdout.on('data',x=>out+=x); p.stderr.on('data',x=>err+=x); p.on('error',reject); p.on('close',code=>resolve({code,out:out.trim(),err}));
  });
  const state=()=>({...db.prepare('SELECT * FROM jobs WHERE id=1').get()});
  const counts=bucket=>({...db.prepare("SELECT count(*) FILTER(WHERE state='reserved') AS reserved,count(*) FILTER(WHERE state='spent') AS spent,count(*) FILTER(WHERE state='released') AS released FROM reservations WHERE bucket=?").get(bucket)});
  const reset=()=>{db.exec("DELETE FROM reservations; DELETE FROM jobs; DELETE FROM buckets; INSERT INTO buckets VALUES('A',1),('B',1); INSERT INTO jobs VALUES(1,'queued',0,0)");};
  try {
    db.exec("PRAGMA journal_mode=WAL; CREATE TABLE jobs(id INTEGER PRIMARY KEY,state TEXT NOT NULL CHECK(state IN ('queued','claimed','effect_pending','done','done_reconciled')),fence INTEGER NOT NULL,lease INTEGER NOT NULL); CREATE TABLE buckets(id TEXT PRIMARY KEY,cap INTEGER NOT NULL CHECK(cap>=0)); CREATE TABLE reservations(job INTEGER NOT NULL REFERENCES jobs(id),fence INTEGER NOT NULL,bucket TEXT NOT NULL REFERENCES buckets(id),state TEXT NOT NULL CHECK(state IN ('reserved','spent','released')),PRIMARY KEY(job,fence))");
    reset(); assert.deepEqual(claim(db,0,10,'A'),{id:1,fence:1});
    const race=await Promise.all([child('mark'),...Array.from({length:8},()=>child('reap'))]);
    assert.ok(race.every(r=>r.code===0),JSON.stringify(race)); assert.equal(race[0].out,'0'); assert.equal(race.slice(1).reduce((s,r)=>s+Number(r.out),0),1);
    assert.equal(state().state,'queued'); assert.deepEqual(counts('A'),{reserved:0,spent:0,released:1});
    const contenders=await Promise.all(Array.from({length:8},()=>child('claim'))); assert.ok(contenders.every(r=>r.code===0),JSON.stringify(contenders));
    assert.deepEqual(contenders.map(r=>JSON.parse(r.out)).filter(Boolean),[{id:1,fence:2}]); assert.equal(mark(db,1,1,11),0);
    assert.deepEqual(counts('A'),{reserved:1,spent:0,released:1});
    console.log('PASS expiry at boundary: release once, one reclaim, stale marker rejected (17 child processes)');
    reset(); claim(db,0,10,'A'); assert.equal((await child('reap-crash')).code,41);
    assert.equal(state().state,'claimed'); assert.deepEqual(counts('A'),{reserved:1,spent:0,released:0}); assert.equal(reap(db,10),1);
    console.log('PASS process crash mid-reap rolls back release and queue transition');
    reset(); claim(db,0,10,'A'); assert.equal(reap(db,9),0); assert.equal(mark(db,1,1,9),1);
    assert.equal(heartbeat(db,1,1,9,30),1); assert.equal(reap(db,10),0); assert.equal(claim(db,10,20,'B'),null);
    assert.equal(finish(db,1,1,29),1); assert.equal(heartbeat(db,1,1,29,40),0); assert.deepEqual(counts('A'),{reserved:0,spent:1,released:0});
    console.log('PASS heartbeat after durable marker allows late valid completion; spent retained');
    reset(); claim(db,0,10,'A'); mark(db,1,1,9); db.close(); db=open(path);
    assert.equal(reap(db,10),0); assert.equal(heartbeat(db,1,1,10,20),0); assert.equal(finish(db,1,1,10),0); assert.equal(claim(db,10,20,'B'),null);
    assert.equal(reconcile(db,1,1,11,'unverified'),0); assert.equal(state().state,'effect_pending');
    assert.equal(reconcile(db,1,2,11,'synthetic-verified-success'),0); assert.equal(reconcile(db,1,1,11,'synthetic-verified-success'),1);
    assert.equal(reconcile(db,1,1,12,'synthetic-verified-success'),0); assert.equal(state().state,'done_reconciled');
    assert.deepEqual(counts('A'),{reserved:0,spent:1,released:0}); assert.deepEqual(counts('B'),{reserved:0,spent:0,released:0});
    console.log('PASS postmarker restart and expiry: no replay/refund; synthetic reconciliation once');
    reset(); claim(db,0,10,'A'); assert.equal(reap(db,10),1); assert.deepEqual(claim(db,10,20,'B'),{id:1,fence:2});
    assert.deepEqual(counts('A'),{reserved:0,spent:0,released:1}); assert.deepEqual(counts('B'),{reserved:1,spent:0,released:0});
    assert.equal(mark(db,1,1,11),0); assert.equal(mark(db,1,2,11),1); assert.equal(finish(db,1,2,12),1);
    console.log('PASS release targets original quota bucket; new attempt uses new bucket');
    console.log('5/5 pass');
  } finally {try{db.close()}catch{} rmSync(dir,{recursive:true,force:true});}
}
