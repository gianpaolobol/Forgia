import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {spawn, type ChildProcess} from 'node:child_process';
import {once} from 'node:events';
import {openJobLedger} from '../server/jobLedger.ts';

const moduleURL = new URL('../server/jobLedger.ts',import.meta.url).href;
function fixture(t: {after: (fn: () => void) => void}) {
  const dir=mkdtempSync(join(tmpdir(),'forgia-recovery-'));
  const path=join(dir,'jobs.sqlite'), ledger=openJobLedger(path);
  t.after(()=>{ledger.close();rmSync(dir,{recursive:true,force:true});});
  return {path,ledger};
}
// Separate OS processes synchronize on IPC, not shared JS memory.
async function child(t: {after: (fn: () => void) => void}, path: string, id: string, mode: string) {
  const code = `import {openJobLedger} from ${JSON.stringify(moduleURL)};
    const db=openJobLedger(process.argv[1]), id=process.argv[2], mode=process.argv[3];
    process.on('message',()=>{
      let result;
      if(mode==='enqueue') result=db.enqueue('s','key','payload');
      else {result=db.claim(id,100,10); if(result && mode==='dispatch') db.markDispatched({id:result.id,fence:result.fence,worker:id},101);}
      process.send(result);
      if(mode==='enqueue'||mode==='claim'){db.close();process.disconnect();}
    }); process.send('ready');`;
  const p=spawn(process.execPath,['--experimental-strip-types','--input-type=module','-e',code,path,id,mode],{stdio:['ignore','ignore','inherit','ipc']});
  t.after(()=>{p.kill();});
  const closed=once(p,'exit');
  assert.equal((await once(p,'message'))[0],'ready');
  return {p,closed};
}
function go(p: ChildProcess) {const result=once(p,'message');p.send('go');return result.then(([message])=>message);}
test('reject invalid clocks without changing claimed job; clear terminal lease',t=>{
  const {ledger:l}=fixture(t); const id=l.enqueue('s','k','x'); const row=l.claim('a',100,10)!;
  const lease={id,fence:row.fence,worker:'a'};
  for(const now of [NaN,Infinity,-1,1.5,Number.MAX_SAFE_INTEGER+1]) {
    assert.throws(()=>l.markDispatched(lease,now)); assert.throws(()=>l.finish(lease,now,'done','x'));
    assert.throws(()=>l.recoverExpired(now)); assert.throws(()=>l.heartbeat(lease,now,1));
  }
  assert.throws(()=>l.heartbeat(lease,Number.MAX_SAFE_INTEGER,1));
  assert.throws(()=>l.markDispatched({...lease,fence:0},101));
  assert.equal(l.read(id,'s')?.status,'claimed');
  assert.equal(l.markDispatched(lease,101),true);
  assert.equal(l.finish(lease,102,'done','ok'),true);
  assert.equal(l.read(id,'s')?.worker,null); assert.equal(l.read(id,'s')?.expires,null);
});
test('two processes claim one job exactly once', {timeout:15000},async t=>{
  const {path,ledger:l}=fixture(t); const id=l.enqueue('s',null,'x');
  const a=await child(t,path,'a','claim'), b=await child(t,path,'b','claim');
  const results=await Promise.all([go(a.p),go(b.p)]);
  assert.equal(results.filter(Boolean).length,1); assert.equal(results.find(Boolean).id,id);
  for(const c of [a,b]) assert.deepEqual(await c.closed,[0,null]);
});
test('two processes submitting the same key get the same ID', {timeout:15000},async t=>{
  const {path,ledger:l}=fixture(t); const a=await child(t,path,'a','enqueue'),b=await child(t,path,'b','enqueue');
  const [x,y]=await Promise.all([go(a.p),go(b.p)]); assert.equal(typeof x,'string'); assert.equal(x,y);
  for(const c of [a,b]) assert.deepEqual(await c.closed,[0,null]);
  assert.throws(()=>l.enqueue('s','key','different'),{status:409});
});
for(const mode of ['hold','dispatch']) test('process killed '+mode+' — conservative recovery', {timeout:15000},async t=>{
  const {path,ledger:l}=fixture(t); const id=l.enqueue('s','k','x'); const a=await child(t,path,'a',mode);
  const row=await go(a.p); assert.equal(row.id,id);
  assert.equal(a.p.kill('SIGKILL'),true); await a.closed;
  assert.deepEqual(l.recoverExpired(109),{queued:0,uncertain:0});
  assert.deepEqual(l.recoverExpired(110),mode==='dispatch'?{queued:0,uncertain:1}:{queued:1,uncertain:0});
  assert.deepEqual(l.recoverExpired(110),{queued:0,uncertain:0});
  const next=l.claim('b',110,10);
  if(mode==='dispatch'){assert.equal(next,null);assert.equal(l.read(id,'s')?.status,'uncertain');}
  else {assert.equal(next?.id,id);assert.equal(next?.fence,row.fence+1);}
  assert.equal(l.finish({id,fence:row.fence,worker:'a'},111,'done','stale'),false);
});
