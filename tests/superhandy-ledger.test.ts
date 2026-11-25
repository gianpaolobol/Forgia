import test,{type TestContext} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync,mkdirSync,writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {spawnSync,execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {openSuperhandyLedger,validateBaseline} from '../server/superhandyLedger.ts';
const plan={project:'demo',planner:'planner',reviewer:'reviewer',executors:['one','two'],tasks:[{id:'a',depends:[],criterion:'test A'},{id:'b',depends:['a'],criterion:'test B'}]};
const hash='a'.repeat(64),other='b'.repeat(64);
function fixture(t:TestContext){
 const dir=mkdtempSync(join(tmpdir(),'forgia-sh-')),path=join(dir,'x.sqlite');let now=100;
 const db=openSuperhandyLedger(path,true,()=>now);t.after(()=>{db.close();rmSync(dir,{recursive:true,force:true});});
 const sha=db.install(plan);return {db,sha,path,advance:()=>{now+=100000;},reopen:()=>openSuperhandyLedger(path,false,()=>now)};
}
test('H1 invalid DAG and immutable baseline',t=>{
 assert.throws(()=>validateBaseline({...plan,tasks:[{id:'a',depends:['a'],criterion:'x'}]}));
 assert.throws(()=>validateBaseline({...plan,tasks:[{id:'a',depends:['z'],criterion:'x'}]}));
 assert.throws(()=>validateBaseline({...plan,executors:['reviewer']}));
 const {db,sha}=fixture(t);assert.equal(db.inspect().baselineSha,sha);assert.throws(()=>db.install(plan));
});
test('H2 review gates and exact baseline digest',t=>{
 const {db,sha}=fixture(t);assert.throws(()=>db.claim('one'));assert.throws(()=>db.approve('planner',sha,hash));assert.throws(()=>db.approve('reviewer',other,hash));db.approve('reviewer',sha,hash);assert.throws(()=>db.claim('reviewer'));assert.throws(()=>db.approve('reviewer',sha,hash));
});
test('H3 separate connections, one claim and stale fence',t=>{
 const {db,sha,reopen}=fixture(t);db.approve('reviewer',sha,hash);const a=db.claim('one')!.lease;const b=reopen();try{assert.equal(b.claim('two'),null);db.handoff(a,hash);const next=b.claim('two')!;assert.equal(next.checkpoint,hash);assert.ok(next.lease.fence>a.fence);assert.throws(()=>db.dispatch(a));}finally{b.close();}
});
test('H4 handoff is bounded and never allowed after dispatch',t=>{
 const {db,sha}=fixture(t);db.approve('reviewer',sha,hash);for(let i=0;i<3;i++){const lease=db.claim(i%2?'two':'one')!.lease;assert.equal(db.handoff(lease,hash),i<2?'queued':'blocked');}assert.equal(db.claim('two'),null);
});
test('H5 expired dispatch is uncertain after reopen; no replay',t=>{
 const {db,sha,advance,reopen}=fixture(t);db.approve('reviewer',sha,hash);const lease=db.claim('one')!.lease;db.dispatch(lease);assert.throws(()=>db.handoff(lease,hash));advance();const b=reopen();try{assert.equal(b.claim('two'),null);assert.equal(b.inspect().tasks[0].status,'uncertain');assert.throws(()=>db.submit(lease,hash));}finally{b.close();}
});
test('H6 same reviewer rejects, reopens, then unlocks dependent task only after acceptance',t=>{
 const {db,sha}=fixture(t);db.approve('reviewer',sha,hash);let lease=db.claim('one')!.lease;db.dispatch(lease);db.submit(lease,hash);assert.equal(db.claim('two'),null);assert.throws(()=>db.review('one','a',hash,'accept',other));assert.throws(()=>db.review('reviewer','a',other,'accept',other));db.review('reviewer','a',hash,'reject',other);lease=db.claim('two')!.lease;db.dispatch(lease);db.submit(lease,other);db.review('reviewer','a',other,'accept',hash);assert.equal(db.claim('one')!.task.id,'b');assert.ok(db.inspect().events.length>8);
});
test('H7 local CLI creates private archive and reads across processes',t=>{
 const dir=mkdtempSync(join(tmpdir(),'forgia-sh-cli-'));t.after(()=>rmSync(dir,{recursive:true,force:true}));const root=join(dir,'data');mkdirSync(root,{mode:0o700});const p=join(dir,'plan.json');writeFileSync(p,JSON.stringify(plan));
 const run=(...args:string[])=>spawnSync(process.execPath,['--experimental-strip-types','scripts/superhandy.ts',...args],{encoding:'utf8',env:{...process.env,FORGIA_DATA_DIR:root}});
 const init=run('init','demo',p);assert.equal(init.status,0,init.stderr);const sha=JSON.parse(init.stdout);assert.notEqual(run('claim','demo','one').status,0);assert.equal(run('approve','demo','reviewer',sha,hash).status,0);const c=run('claim','demo','one');assert.equal(c.status,0,c.stderr);assert.equal(JSON.parse(c.stdout).task.id,'a');assert.notEqual(run('init','demo',p).status,0);assert.equal(JSON.parse(run('inspect','demo').stdout).tasks[0].status,'claimed');
});
test('H8 heartbeat extends an active lease but cannot revive an expired fence',t=>{
 const {db,sha,advance}=fixture(t);db.approve('reviewer',sha,hash);const lease=db.claim('one')!.lease;db.heartbeat(lease,200000);advance();db.dispatch(lease);advance();assert.throws(()=>db.heartbeat(lease));assert.equal(db.inspect().tasks[0].status,'uncertain');
});
test('H9 two real competing CLI processes obtain exactly one claim',async t=>{
 const dir=mkdtempSync(join(tmpdir(),'forgia-sh-race-'));t.after(()=>rmSync(dir,{recursive:true,force:true}));const root=join(dir,'data');mkdirSync(root,{mode:0o700});const p=join(dir,'plan.json');writeFileSync(p,JSON.stringify(plan));
 const run=(...args:string[])=>promisify(execFile)(process.execPath,['--experimental-strip-types','scripts/superhandy.ts',...args],{encoding:'utf8',env:{...process.env,FORGIA_DATA_DIR:root}});
 const sha=JSON.parse((await run('init','demo',p)).stdout);await run('approve','demo','reviewer',sha,hash);
 const outcomes=(await Promise.all([run('claim','demo','one'),run('claim','demo','two')])).map(r=>JSON.parse(r.stdout));assert.equal(outcomes.filter(v=>v!==null).length,1);assert.equal(outcomes.find(v=>v!==null).task.id,'a');
 const state=JSON.parse((await run('inspect','demo')).stdout);assert.equal(state.events.filter((e:{action:string})=>e.action==='claim').length,1);
});
