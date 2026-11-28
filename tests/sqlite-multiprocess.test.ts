import {test} from 'node:test';
import assert from 'node:assert/strict';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {mkdtempSync,rmSync,existsSync,readFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {openJobLedger} from '../server/jobLedger.ts';
import {openQuotaLedger} from '../server/quotaLedger.ts';

const exec = promisify(execFile);
const jobURL = new URL('../server/jobLedger.ts',import.meta.url).href;
const quotaURL = new URL('../server/quotaLedger.ts',import.meta.url).href;
const clock = 1800000000000;
const session = '00000000-0000-0000-0000-000000000001';
const payload = JSON.stringify({idea:'Fixture',provider:'local',consent:false,context:{kind:'catalog',phase:'draft'}});
const child = `
import assert from 'node:assert/strict';
import {writeFileSync,existsSync} from 'node:fs';
import {join} from 'node:path';
import {setTimeout as delay} from 'node:timers/promises';
const [jobURL,quotaURL,dir,worker,mode,cap,at] = process.argv.slice(1);
const now = Number(at);
const {openJobLedger} = await import(jobURL);
const jobs = openJobLedger(join(dir,'jobs.sqlite'));
if (mode === 'race') {
  const {openQuotaLedger} = await import(quotaURL);
  const quota = openQuotaLedger(join(dir,'quota.sqlite'),()=>now);
  writeFileSync(join(dir,'ready-'+worker),'');
  const deadline = Date.now()+15000;
  while (!Array.from({length:8},(_,i)=>existsSync(join(dir,'ready-'+i))).every(Boolean)) {
    if (Date.now()>deadline) throw Error('Barrier timeout');
    await delay(10);
  }
  const claim = jobs.claim(worker,now,30000);
  const grants = Array.from({length:3},()=>quota.reserve('openrouter',Number(cap)));
  console.log(JSON.stringify({claim,grants}));
  quota.close(); jobs.close();
} else {
  const claim = jobs.claim(worker,now,30000);
  assert.ok(claim);
  if (mode !== 'before-marker') assert.equal(jobs.markDispatched(claim,now),true);
  if (mode === 'after-effect') writeFileSync(join(dir,'synthetic-effect'),claim.id,{flag:'wx'});
  // Abrupt process exit; no ledger.close or application cleanup.
  process.exit(73);
}
`;
function run(dir:string,worker:string,mode:string,cap:number) {
  return exec(process.execPath,['--experimental-strip-types','--input-type=module','-e',child,jobURL,quotaURL,dir,worker,mode,String(cap),String(clock)],{timeout:30000,maxBuffer:128*1024});
}

test('MP1 eight OS processes: unique claim and durable quota cap, 3 repetitions at 5 and 20',{timeout:180000},async () => {
  for (const cap of [5,20]) for (let repeat=0;repeat<3;repeat++) {
    const dir=mkdtempSync(join(tmpdir(),'forgia-mp-'));
    try {
      const jobs=openJobLedger(join(dir,'jobs.sqlite'));
      const id=jobs.enqueue(session,'fixture:p1',payload); jobs.close();
      const quota=openQuotaLedger(join(dir,'quota.sqlite'),()=>clock); quota.initialize(null); quota.close();
      const settled=await Promise.allSettled(Array.from({length:8},(_,i)=>run(dir,String(i),'race',cap)));
      const rows=settled.map(r=>{if(r.status==='rejected')throw r.reason;return JSON.parse(r.value.stdout) as {claim:{id:string;fence:number;worker:string}|null;grants:{granted:boolean;used:number;reason?:string}[]};});
      const claims=rows.flatMap(r=>r.claim?[r.claim]:[]);
      assert.equal(claims.length,1); assert.equal(claims[0].id,id); assert.equal(claims[0].fence,1);
      const grants=rows.flatMap(r=>r.grants);
      assert.equal(grants.length,24);
      assert.deepEqual(grants.filter(g=>g.granted).map(g=>g.used).sort((a,b)=>a-b),Array.from({length:cap},(_,i)=>i+1));
      assert.ok(grants.filter(g=>!g.granted).every(g=>g.reason==='quota'));
      const reopenedQuota=openQuotaLedger(join(dir,'quota.sqlite'),()=>clock);
      try {assert.equal(reopenedQuota.read('openrouter').used,cap);assert.equal(reopenedQuota.reserve('openrouter',cap).granted,false);}finally{reopenedQuota.close();}
      const reopenedJobs=openJobLedger(join(dir,'jobs.sqlite'));
      try {
        assert.equal(reopenedJobs.claim('early',clock+29999,30000),null);
        const next=reopenedJobs.claim('replacement',clock+30000,30000);
        assert.ok(next);assert.equal(next.id,id);assert.equal(next.fence,2);
        assert.equal(reopenedJobs.markDispatched(claims[0],clock+30000),false);
        assert.equal(reopenedJobs.markDispatched(next,clock+30000),true);
        assert.equal(reopenedJobs.finish(next,clock+30001,'done','{}'),true);
      }finally{reopenedJobs.close();}
      console.log('MP1 cap=%d repeat=%d claims=1 grants=%d denied=%d',cap,repeat+1,cap,24-cap);
    }finally{rmSync(dir,{recursive:true,force:true});}
  }
});

for (const mode of ['before-marker','after-marker','after-effect']) {
  test('MP2 process exit and recovery: '+mode,{timeout:40000},async () => {
    const dir=mkdtempSync(join(tmpdir(),'forgia-crash-'));
    try {
      const jobs=openJobLedger(join(dir,'jobs.sqlite'));
      const id=jobs.enqueue(session,'fixture:p1',payload);jobs.close();
      await assert.rejects(run(dir,'crashed',mode,5),{code:73});
      const reopened=openJobLedger(join(dir,'jobs.sqlite'));
      try {
        const row=reopened.read(id,session); assert.ok(row);
        assert.equal(row.status,mode==='before-marker'?'claimed':'dispatched');
        assert.equal(reopened.claim('early',clock+29999,30000),null);
        const next=reopened.claim('replacement',clock+30000,30000);
        if(mode==='before-marker') {
          assert.ok(next);assert.equal(next.id,id);assert.equal(next.fence,2);
          assert.equal(reopened.markDispatched({id,fence:1,worker:'crashed'},clock+30000),false);
        } else {
          assert.equal(next,null);assert.equal(reopened.read(id,session)?.status,'uncertain');
          assert.equal(reopened.enqueue(session,'fixture:p1',payload),id);
          assert.equal(reopened.claim('again',clock+60000,30000),null);
          assert.equal(reopened.finish({id,fence:1,worker:'crashed'},clock+60000,'done','{}'),false);
        }
        assert.equal(existsSync(join(dir,'synthetic-effect')),mode==='after-effect');
        if(mode==='after-effect') assert.equal(readFileSync(join(dir,'synthetic-effect'),'utf8'),id);
      }finally{reopened.close();}
    }finally{rmSync(dir,{recursive:true,force:true});}
  });
}
