import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {spawn} from 'node:child_process';
import {openQuotaLedger} from '../server/quotaLedger.ts';

const start = Date.parse('2026-11-25T23:59:00Z');
function fixture(t: {after: (f:()=>void)=>void}) {
  const dir = mkdtempSync(join(tmpdir(),'forgia-quota-'));
  t.after(()=>rmSync(dir,{recursive:true,force:true}));
  return join(dir,'quota.sqlite');
}

test('Q1: explicit bootstrap, imports counts, persists on reopen, no reset', t=>{
  const path=fixture(t), a=openQuotaLedger(path,()=>start);
  assert.throws(()=>a.reserve('groq'));
  a.initialize({version:1,day:'2026-11-25',counts:{groq:19,local:999,openrouter:22}});
  assert.deepEqual(a.reserve('groq'),{granted:true,used:20});
  assert.equal(a.reserve('openrouter').granted,false);
  a.close();
  const b=openQuotaLedger(path,()=>start);
  try {assert.throws(()=>b.initialize(null));assert.equal(b.reserve('groq').granted,false);assert.equal(b.read('groq').used,20);} finally {b.close();}
});

test('Q2: reserve floor enforced inside shared transaction, no refund',t=>{
  const path=fixture(t),a=openQuotaLedger(path,()=>start),b=openQuotaLedger(path,()=>start);
  try {a.initialize(null);for(let i=0;i<12;i++)assert.equal(a.reserve('groq',20,8).granted,true);
    assert.equal(b.reserve('groq',20,8).granted,false);
    for(let i=0;i<8;i++)assert.equal(b.reserve('groq').granted,true);
    assert.equal(a.reserve('groq').granted,false);assert.equal(a.read('groq').used,20);
    assert.equal(b.reserve('cloudflare').granted,true);
  }finally{a.close();b.close();}
});

test('Q3: UTC rollover and rollback of clock across restart',t=>{
  const path=fixture(t);let now=start;const a=openQuotaLedger(path,()=>now);
  a.initialize(null);a.reserve('groq');now+=60000;assert.equal(a.reserve('groq').used,1);a.close();
  const b=openQuotaLedger(path,()=>now);try{now--;assert.throws(()=>b.reserve('groq'));now++;assert.equal(b.reserve('groq').used,2);}finally{b.close();}
});

test('Q4: cooldown survives restart and UTC boundary, cannot shorten',t=>{
  const path=fixture(t);let now=start;const a=openQuotaLedger(path,()=>now);
  a.initialize(null);a.reserve('groq');const until=now+120000;a.cooldown('groq',until);assert.equal(a.cooldown('groq',now+30000),until);a.close();
  now+=60000;const b=openQuotaLedger(path,()=>now);try{assert.deepEqual(b.reserve('groq'),{granted:false,reason:'cooldown',used:0,nextEligibleAt:until});now=until;assert.equal(b.reserve('groq').used,1);}finally{b.close();}
});

test('Q5: rejects unknown/local provider, unsafe limit, invalid dates and counts',t=>{
  const a=openQuotaLedger(fixture(t),()=>start);try{
    for(const snap of [{version:1,day:'2026-11-26',counts:{}},{version:1,day:'2026-02-30',counts:{}},{version:1,day:'2026-11-25',counts:{groq:-1}},{version:1,day:'2026-11-25',counts:{unknown:0}},undefined])assert.throws(()=>a.initialize(snap));
    a.initialize(null);
    for(const id of ['local','__proto__','gemini'])assert.throws(()=>a.reserve(id));
    for(const limit of [0,21,NaN,1.5])assert.throws(()=>a.reserve('groq',limit));
    assert.throws(()=>a.reserve('groq',20,21));assert.throws(()=>a.cooldown('groq',Infinity));assert.throws(()=>a.cooldown('groq',start));assert.equal(a.read('groq').used,0);
  }finally{a.close();}
});

test('Q6: distinct OS processes contend for last five grants',async t=>{
  const path=fixture(t);const a=openQuotaLedger(path,()=>start);a.initialize({version:1,day:'2026-11-25',counts:{groq:15}});a.close();
  const url=new URL('../server/quotaLedger.ts',import.meta.url).href;
  const code=`import {openQuotaLedger} from ${JSON.stringify(url)}; const q=openQuotaLedger(process.argv[1],()=>${start});let n=0;for(let i=0;i<10;i++)if(q.reserve('groq').granted)n++;q.close();console.log(n);`;
  const run=()=>new Promise<number>((resolve,reject)=>{const p=spawn(process.execPath,['--experimental-strip-types','--input-type=module','-e',code,path]);let output='',err='';p.stdout.on('data',c=>output+=c);p.stderr.on('data',c=>err+=c);p.on('error',reject);p.on('close',c=>c===0?resolve(Number(output.trim())):reject(Error(err)));});
  const counts=await Promise.all(Array.from({length:4},run));assert.equal(counts.reduce((x,y)=>x+y,0),5);
  const b=openQuotaLedger(path,()=>start);try{assert.equal(b.read('groq').used,20);assert.equal(b.reserve('groq').granted,false);}finally{b.close();}
});

test('Q7: rejected bootstrap does not create initialized marker; past count not reused',t=>{
  const a=openQuotaLedger(fixture(t),()=>start);try{assert.throws(()=>a.initialize({version:1,day:'2026-11-25',counts:{groq:19,cloudflare:1.5}}));assert.throws(()=>a.read('groq'));a.initialize({version:1,day:'2026-11-24',counts:{groq:20}});assert.equal(a.reserve('groq').used,1);}finally{a.close();}
});
