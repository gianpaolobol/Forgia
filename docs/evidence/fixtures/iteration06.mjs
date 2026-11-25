import {DatabaseSync} from 'node:sqlite';
import {spawn} from 'node:child_process';
import {mkdtempSync, rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {fileURLToPath} from 'node:url';
import assert from 'node:assert/strict';
// Isolated SQLite feasibility probe, not Forgia application code or a migration.
const open = path => {const db=new DatabaseSync(path);db.exec('PRAGMA busy_timeout=5000');return db;};
function reserve(db){
  db.exec('BEGIN IMMEDIATE');
  try {const changed=db.prepare('UPDATE quota SET used=used+1 WHERE id=1 AND used<cap').run().changes;db.exec('COMMIT');return changed;}
  catch(e){db.exec('ROLLBACK');throw e;}
}
if(process.argv[2]==='worker'){
  const db=open(process.argv[3]);console.log(reserve(db));db.close();
}else if(process.argv[2]==='crash'){
  const db=open(process.argv[3]);db.exec('BEGIN IMMEDIATE; UPDATE quota SET used=used+1 WHERE id=1;');process.exit(23);
}else{
  const dir=mkdtempSync(join(tmpdir(),'forgia-sqlite-probe-'));
  const path=join(dir,'probe.sqlite');const db=open(path);
  function child(mode){return new Promise((resolve,reject)=>{const p=spawn(process.execPath,['--experimental-sqlite',fileURLToPath(import.meta.url),mode,path],{stdio:['ignore','pipe','pipe']});let out='',err='';p.stdout.on('data',x=>out+=x);p.stderr.on('data',x=>err+=x);p.on('error',reject);p.on('close',code=>resolve({code,out:out.trim(),err}));});}
  const count=()=>db.prepare('SELECT used FROM quota WHERE id=1').get().used;
  const claim=(now,until)=>db.prepare("UPDATE jobs SET state='claimed', fence=fence+1, lease=? WHERE id=1 AND (state='queued' OR (state='claimed' AND lease<=?)) RETURNING fence").get(until,now)?.fence;
  const finish=fence=>db.prepare("UPDATE jobs SET state='done' WHERE id=1 AND fence=? AND state='claimed'").run(fence).changes;
  try{
    console.log('SQLite',db.prepare('SELECT sqlite_version() AS v').get().v);
    db.exec("PRAGMA journal_mode=WAL; CREATE TABLE quota(id INTEGER PRIMARY KEY,used INTEGER NOT NULL,cap INTEGER NOT NULL,CHECK(used>=0 AND used<=cap)); INSERT INTO quota VALUES(1,0,3); CREATE TABLE jobs(id INTEGER PRIMARY KEY,state TEXT NOT NULL,fence INTEGER NOT NULL,lease INTEGER NOT NULL); INSERT INTO jobs VALUES(1,'queued',0,0)");
    const results=await Promise.all(Array.from({length:8},()=>child('worker')));
    assert.ok(results.every(x=>x.code===0&&/^[01]$/.test(x.out)),JSON.stringify(results));
    assert.equal(results.reduce((n,x)=>n+Number(x.out),0),3);assert.equal(count(),3);
    console.log('PASS 8 OS processes, cap 3: 3 reservations, persisted 3');
    db.exec('UPDATE quota SET used=0 WHERE id=1');assert.equal((await child('crash')).code,23);assert.equal(count(),0);
    console.log('PASS uncommitted reservation rolled back after process exit');
    const old=claim(0,10);assert.equal(old,1);assert.equal(claim(9,20),undefined);const fresh=claim(10,20);assert.equal(fresh,2);assert.equal(finish(old),0);assert.equal(finish(fresh),1);
    console.log('PASS expired lease reclaimed; stale fencing token rejected');
    db.exec("UPDATE jobs SET state='queued', lease=0 WHERE id=1");const dispatched=claim(21,30);
    assert.equal(db.prepare("UPDATE jobs SET state='effect_pending' WHERE id=1 AND state='claimed' AND fence=?").run(dispatched).changes,1);
    assert.equal(claim(31,40),undefined);assert.equal(finish(dispatched),0);
    console.log('PASS uncertain external effect is not automatically reclaimed');
    db.close();const reopened=open(path);assert.equal(reopened.prepare('SELECT state FROM jobs WHERE id=1').get().state,'effect_pending');reopened.close();
    console.log('PASS uncertain effect marker survives reopen');
    console.log('5/5 pass');
  }finally{try{db.close();}catch{}rmSync(dir,{recursive:true,force:true});}
}
