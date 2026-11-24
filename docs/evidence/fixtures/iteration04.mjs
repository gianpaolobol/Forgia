import {fork} from 'node:child_process';
import {randomUUID} from 'node:crypto';
import {mkdtemp, rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {fileURLToPath} from 'node:url';
import assert from 'node:assert/strict';
import {createJobs} from '../../../server/jobs.ts';
import {diskStorage} from '../../../server/disk.ts';
const key = 'jobs.v1';
const input = {idea:'Synthetic queue fixture',provider:'auto',consent:false,context:{kind:'catalog',phase:'draft'}};
const sleep = ms => new Promise(r=>setTimeout(r,ms));
async function poll(fn, predicate) {
  for(let i=0;i<200;i++){ const v=await fn(); if(predicate(v)) return v; await sleep(10); }
  throw Error('poll timeout');
}
if(process.argv[2]==='worker'){
  const disk=diskStorage(process.argv[3]);
  let unlock; const gate=new Promise(r=>unlock=r);
  process.on('message',m=>{if(m==='go')unlock();});
  const wrapped={...disk,async getItem(k){const snapshot=await disk.getItem(k);process.send('snapshot');await gate;return snapshot;}};
  const queue=createJobs(wrapped, async()=>{process.send('executed');return process.pid;});
  const result=await poll(()=>queue.read(process.argv[4]), v=>v?.status==='done');
  process.send({done:result},()=>process.disconnect());
}else{
  const dir=await mkdtemp(join(tmpdir(),'forgia-audit-'));
  const children=[]; const failures=[];
  async function check(name,fn){try{await fn();console.log('PASS',name);}catch(e){failures.push(name);console.log('FAIL',name,e.message);}}
  try {
    await check('F05 unique dispatch across two OS processes',async()=>{
      const disk=diskStorage(dir), id=randomUUID();
      await disk.setItem(key,JSON.stringify([{id,session:randomUUID(),status:'queued',input}]));
      let snapshots=0, executions=0, dones=0;
      const result=new Promise((resolve,reject)=>{
        const timer=setTimeout(()=>reject(Error('workers timeout')),8000);
        for(let i=0;i<2;i++){
          const c=fork(fileURLToPath(import.meta.url),['worker',dir,id],{execArgv:['--experimental-strip-types'],stdio:['ignore','ignore','inherit','ipc']});children.push(c);
          c.on('error',reject); c.on('exit',code=>{if(code)reject(Error(`worker exit ${code}`));});
          c.on('message',m=>{if(m==='snapshot'&&++snapshots===2)children.forEach(w=>w.send('go'));if(m==='executed')executions++;if(m?.done&&++dones===2){clearTimeout(timer);resolve(executions);}});
        }
      });
      const count=await result; console.log('observed executions:',count);assert.equal(count,1);
    });
    await check('F05 429 should remain recoverable, not terminal failure',async()=>{
      const d=diskStorage(join(dir,'rate')), id=randomUUID();
      await d.setItem(key,JSON.stringify([{id,session:randomUUID(),status:'queued',input}]));
      const queue=createJobs(d,async()=>{throw Object.assign(Error('Synthetic rate limit'),{status:429});});
      const value=await poll(()=>queue.read(id),v=>v?.status==='failed'||v?.status==='suspended');
      console.log('observed rate status:',JSON.stringify(value));assert.equal(value.status,'suspended');
    });
    await check('F05 completed job not repeated after restart',async()=>{
      const d=diskStorage(join(dir,'restart')), id=randomUUID();
      await d.setItem(key,JSON.stringify([{id,session:randomUUID(),status:'done',result:17}]));
      let count=0;const q=createJobs(d,async()=>{count++;return 0;});
      assert.deepEqual(await q.read(id),{status:'done',result:17});await sleep(50);assert.equal(count,0);
    });
  } finally {for(const c of children)if(c.exitCode===null)c.kill();await rm(dir,{recursive:true,force:true});}
  console.log(`${3-failures.length}/3 pass`);process.exitCode=failures.length?1:0;
}
