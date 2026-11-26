import assert from 'node:assert/strict';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createGateway} from '../../../server/gateway.ts';
import {diskStorage} from '../../../server/disk.ts';
const dir=await mkdtemp(join(tmpdir(),'forgia-quota-'));
const output=JSON.stringify({name:'Orto',idea:'Catalogo',kind:'catalog',quiz:false,items:[{name:'Lavanda',category:'Aromatiche',color:''}]});
let calls=0, failures=0;
const provider={id:'groq',mode:'free',model:'fixture',eligible:async()=>true,complete:async()=>{calls++;return output;}};
async function check(label,fn){try{await fn();console.log('PASS',label);}catch(e){failures++;console.log('FAIL',label,e.message);}}
try{
  await check('shared storage instance respects daily limit',async()=>{
    calls=0;const disk=diskStorage(join(dir,'shared'));
    const a=createGateway(disk,{dailyLimit:1}),b=createGateway(disk,{dailyLimit:1});
    const results=await Promise.allSettled([a.plan('Idea A',provider,true),b.plan('Idea B',provider,true)]);
    console.log('callbacks:',calls,'statuses:',results.map(x=>x.status));
    assert.equal(calls,1);assert.equal(results.filter(x=>x.status==='fulfilled').length,1);
    assert.equal(results.find(x=>x.status==='rejected').reason.status,429);
  });
  await check('independent storage instances must respect one shared quota',async()=>{
    calls=0;const path=join(dir,'independent');let snapshots=0,release;
    const gate=new Promise(r=>release=r);
    const wrap=()=>{const disk=diskStorage(path);return {...disk,async getItem(k){const value=await disk.getItem(k);if(++snapshots===2)release();await gate;return value;}};};
    const a=createGateway(wrap(),{dailyLimit:1}),b=createGateway(wrap(),{dailyLimit:1});
    const results=await Promise.allSettled([a.plan('Idea A',provider,true),b.plan('Idea B',provider,true)]);
    const persisted=JSON.parse(await diskStorage(path).getItem('gateway.v1'));
    console.log('callbacks:',calls,'persisted:',persisted.counts.groq,'statuses:',results.map(x=>x.status));
    assert.equal(calls,1);assert.equal(results.filter(x=>x.status==='fulfilled').length,1);
    assert.equal(persisted.counts.groq,calls);
  });
  await check('no cloud consent means no callback',async()=>{
    calls=0;const gateway=createGateway(diskStorage(join(dir,'consent')),{dailyLimit:1});
    await assert.rejects(gateway.plan('Idea A',provider,false),/consenso/);assert.equal(calls,0);
  });
}finally{await rm(dir,{recursive:true,force:true});}
console.log(`${3-failures}/3 pass`);process.exitCode=failures?1:0;
