import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {DatabaseSync} from 'node:sqlite';
import {openQuotaLedger} from '../server/quotaLedger.ts';

const now=Date.parse('2026-11-28T12:00:00Z');
function fixture(t:{after:(f:()=>void)=>void}) {
 const dir=mkdtempSync(join(tmpdir(),'forgia-quota-integrity-'));
 t.after(()=>rmSync(dir,{recursive:true,force:true}));
 const path=join(dir,'cloud.sqlite');
 const q=openQuotaLedger(path,()=>now);
 try{q.initialize({version:1,day:'2026-11-28',counts:{openrouter:20}});}finally{q.close();}
 return path;
}
for(const day of ['', '2026-02-30', '1969-12-31']) {
 test(`QI1: invalid persisted date ${JSON.stringify(day)} cannot reset a spent quota`,t=>{
  const path=fixture(t),db=new DatabaseSync(path);
  try{db.prepare('UPDATE forgia_quota_v1 SET day=? WHERE provider=?').run(day,'openrouter');}finally{db.close();}
  const q=openQuotaLedger(path,()=>now);
  try{assert.throws(()=>q.read('openrouter'),/quota non valido/);assert.throws(()=>q.reserve('openrouter'),/quota non valido/);assert.throws(()=>q.cooldown('openrouter',now+60000),/quota non valido/);}finally{q.close();}
  const verify=new DatabaseSync(path,{readOnly:true});
  try{const row=verify.prepare('SELECT day,used FROM forgia_quota_v1 WHERE provider=?').get('openrouter');assert.equal(row?.day,day);assert.equal(row?.used,20);}finally{verify.close();}
 });
}
test('QI2: negative persisted clock cannot authorize a reservation',t=>{
 const path=fixture(t),db=new DatabaseSync(path);
 try{db.exec('UPDATE forgia_quota_meta_v1 SET last_ms=-1');}finally{db.close();}
 const q=openQuotaLedger(path,()=>now);
 try{assert.throws(()=>q.read('openrouter'),/quota non valido/);assert.throws(()=>q.reserve('groq'),/quota non valido/);}finally{q.close();}
 const verify=new DatabaseSync(path,{readOnly:true});try{assert.equal(verify.prepare('SELECT last_ms FROM forgia_quota_meta_v1').get()?.last_ms,-1);}finally{verify.close();}
});
test('QI3: canonical UTC rollover still permits exactly one new grant',t=>{
 const path=fixture(t),q=openQuotaLedger(path,()=>now+86400000);
 try{assert.deepEqual(q.reserve('openrouter'),{granted:true,used:1});assert.equal(q.read('openrouter').used,1);}finally{q.close();}
});
