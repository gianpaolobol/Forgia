import test from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {receiptLookupHeaders} from '../src/core/receiptLookup.ts';
import {findDurableReceipt} from '../server/receiptLookup.ts';
const origin='http://127.0.0.1:8787';
const session='00112233-4455-6677-8899-aabbccddeeff';
const other='00112233-4455-6677-8899-aabbccddee00';
const id='abcdef01-2345-6789-abcd-ef0123456789';
const marker={origin,session,state:'submitting'} as const;

test('RR1 exact read-only receipt across SQLite reopen; wrong session/key never inserts',t=>{
  const dir=mkdtempSync(join(tmpdir(),'forgia-receipt-')); t.after(()=>rmSync(dir,{recursive:true,force:true}));
  const path=join(dir,'jobs.sqlite');
  const first=new DatabaseSync(path);
  try {
    first.exec('CREATE TABLE forgia_jobs_v1 (id TEXT PRIMARY KEY, session TEXT NOT NULL, request_key TEXT, payload TEXT NOT NULL, status TEXT NOT NULL, UNIQUE(session,request_key))');
    first.prepare('INSERT INTO forgia_jobs_v1 VALUES (?,?,?,?,?)').run(id,session,'p1:p2','private','done');
    first.prepare('INSERT INTO forgia_jobs_v1 VALUES (?,?,?,?,?)').run('other',other,'p1:p2','private','queued');
  } finally { first.close(); }
  const db=new DatabaseSync(path);
  try {
    assert.deepEqual(findDurableReceipt(db,session,'p1:p2'),{id});
    assert.deepEqual(findDurableReceipt(db,other,'p1:p2'),{id:'other'});
    assert.equal(findDurableReceipt(db,session,'p1:p3'),null);
    assert.throws(()=>findDurableReceipt(db,['x'],'p1:p2'),{status:400});
    assert.throws(()=>findDurableReceipt(db,session,"p1:p2' OR 1=1"),{status:400});
    assert.equal(db.prepare('SELECT count(*) n FROM forgia_jobs_v1').get()?.n,2);
    assert.equal(db.prepare('SELECT status FROM forgia_jobs_v1 WHERE id=?').get(id)?.status,'done');
  } finally { db.close(); }
});
test('RR3 only original ambiguous loopback marker produces original headers',()=>{
  const headers=receiptLookupHeaders(marker,origin,'p1','p2');
  assert.deepEqual(headers,{'X-Forgia-Session':session,'Idempotency-Key':'p1:p2'});
  assert.deepEqual(receiptLookupHeaders(JSON.parse(JSON.stringify(marker)),origin,'name with space','p2'),{'X-Forgia-Session':session,'Idempotency-Key':'name%20with%20space:p2'});
  assert.equal(receiptLookupHeaders(marker,origin,'p1'),undefined);
  assert.equal(receiptLookupHeaders(marker,origin,'p1','p2\n'),undefined);
  assert.equal(receiptLookupHeaders(marker,'https://192.168.1.2','p1','p2'),undefined);
  assert.equal(receiptLookupHeaders({origin:'https://192.168.1.2',state:'submitting'},'https://192.168.1.2','p1','p2'),undefined);
  assert.equal(receiptLookupHeaders({...marker,state:'accepted',id},origin,'p1','p2'),undefined);
  assert.equal(receiptLookupHeaders({...marker,state:'closed'},origin,'p1','p2'),undefined);
  assert.equal(receiptLookupHeaders({...marker,session:'invalid'},origin,'p1','p2'),undefined);
  assert.equal(receiptLookupHeaders(undefined,origin,'p1','p2'),undefined);
});
