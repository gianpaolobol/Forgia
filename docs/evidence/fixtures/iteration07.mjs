import { DatabaseSync } from 'node:sqlite';
import { spawn } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import assert from 'node:assert/strict';
// Standalone feasibility experiment; synthetic clock and dispatch, no provider or product code.
function open(path) { const db = new DatabaseSync(path); db.exec('PRAGMA busy_timeout=5000'); return db; }
function claim(db, now, until, crash = false) {
  db.exec('BEGIN IMMEDIATE');
  try {
    const job = db.prepare("SELECT id FROM jobs WHERE state='queued' OR (state='claimed' AND lease<=?) ORDER BY id LIMIT 1").get(now);
    if (!job || !db.prepare('UPDATE quota SET used=used+1 WHERE id=1 AND used<cap').run().changes) { db.exec('ROLLBACK'); return null; }
    const result = db.prepare("UPDATE jobs SET state='claimed', fence=fence+1, lease=? WHERE id=? RETURNING id,fence").get(until, job.id);
    if (crash) process.exit(23);
    db.exec('COMMIT'); return result;
  } catch (e) { db.exec('ROLLBACK'); throw e; }
}
const renew = (db, id, fence, now, until) => db.prepare("UPDATE jobs SET lease=? WHERE id=? AND fence=? AND state='claimed' AND lease>? AND ?>lease").run(until,id,fence,now,until).changes;
const mark = (db, id, fence, now) => db.prepare("UPDATE jobs SET state='effect_pending' WHERE id=? AND fence=? AND state='claimed' AND lease>?").run(id,fence,now).changes;
const finish = (db, id, fence, now) => db.prepare("UPDATE jobs SET state='done' WHERE id=? AND fence=? AND state='effect_pending' AND lease>?").run(id,fence,now).changes;
if (process.argv[2]) {
  const db = open(process.argv[3]);
  if (process.argv[2] === 'precommit') claim(db,0,10,true);
  else if (process.argv[2] === 'postmarker') {
    const job = claim(db,0,10); assert.equal(mark(db,job.id,job.fence,1),1); process.exit(24);
  } else console.log(JSON.stringify(claim(db,0,10)));
  db.close();
} else {
  const dir = mkdtempSync(join(tmpdir(),'forgia-combined-'));
  const path = join(dir,'probe.sqlite'); const db = open(path);
  const child = mode => new Promise((resolve,reject) => {
    const p = spawn(process.execPath,['--experimental-sqlite',fileURLToPath(import.meta.url),mode,path],{stdio:['ignore','pipe','pipe']});
    let out='',err=''; p.stdout.on('data',x=>out+=x); p.stderr.on('data',x=>err+=x); p.on('error',reject); p.on('close',code=>resolve({code,out:out.trim(),err}));
  });
  const used = () => db.prepare('SELECT used FROM quota').get().used;
  const state = () => db.prepare('SELECT id,state,fence,lease FROM jobs ORDER BY id').all().map(x=>({...x}));
  const reset = (cap, jobs) => {
    db.exec('DELETE FROM quota; DELETE FROM jobs'); db.prepare('INSERT INTO quota VALUES(1,0,?)').run(cap);
    for(let id=1;id<=jobs;id++) db.prepare("INSERT INTO jobs VALUES(?,'queued',0,0)").run(id);
  };
  try {
    db.exec('PRAGMA journal_mode=WAL; CREATE TABLE quota(id INTEGER PRIMARY KEY,used INTEGER NOT NULL,cap INTEGER NOT NULL,CHECK(used>=0 AND used<=cap)); CREATE TABLE jobs(id INTEGER PRIMARY KEY,state TEXT NOT NULL,fence INTEGER NOT NULL,lease INTEGER NOT NULL)');
    reset(3,1);
    let results=await Promise.all(Array.from({length:8},()=>child('claim')));
    assert.ok(results.every(x=>x.code===0),JSON.stringify(results));
    assert.equal(results.map(x=>JSON.parse(x.out)).filter(Boolean).length,1); assert.equal(used(),1);
    console.log('PASS 8 processes contend for one job: one claim and one reservation');
    reset(1,3);
    results=await Promise.all(Array.from({length:8},()=>child('claim')));
    assert.ok(results.every(x=>x.code===0),JSON.stringify(results));
    assert.equal(results.map(x=>JSON.parse(x.out)).filter(Boolean).length,1); assert.equal(used(),1);
    assert.equal(state().filter(x=>x.state==='queued'&&x.fence===0).length,2);
    console.log('PASS cap 1, three jobs: one claim, two untouched queued jobs');
    reset(3,1); assert.equal((await child('precommit')).code,23); assert.equal(used(),0);
    assert.deepEqual(state(),[{id:1,state:'queued',fence:0,lease:0}]);
    console.log('PASS process exits before commit: claim and quota both rolled back');
    const first=claim(db,0,10); assert.equal(renew(db,1,first.fence,9,20),1);
    assert.equal(claim(db,10,30),null); assert.equal(renew(db,1,first.fence,20,30),0);
    assert.equal(mark(db,1,first.fence,20),0);
    const next=claim(db,20,30); assert.equal(next.fence,first.fence+1); assert.equal(used(),2);
    assert.equal(mark(db,1,first.fence,21),0); assert.equal(mark(db,1,next.fence,21),1);
    assert.equal(finish(db,1,first.fence,22),0); assert.equal(finish(db,1,next.fence,22),1);
    console.log('PASS heartbeat, expiry boundary, fencing; old reservation retained conservatively');
    reset(3,1); assert.equal((await child('postmarker')).code,24);
    assert.equal(used(),1); assert.equal(state()[0].state,'effect_pending'); assert.equal(claim(db,11,20),null);
    assert.equal(finish(db,1,1,11),0); db.close(); const reopened=open(path);
    assert.equal(reopened.prepare('SELECT state FROM jobs').get().state,'effect_pending'); reopened.close();
    console.log('PASS crash after durable marker: no automatic replay, expired completion rejected');
    console.log('5/5 pass');
  } finally { try { db.close(); } catch {} rmSync(dir,{recursive:true,force:true}); }
}
