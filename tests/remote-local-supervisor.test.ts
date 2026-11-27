import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,realpathSync,rmSync,existsSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {runRemoteLocalSupervisor} from '../server/remoteLocalSupervisor.ts';
import {openRemoteLocalDb,startRemoteLocalHost} from '../server/remoteLocalRuntime.ts';
import {RemoteNodeStatus} from '../server/remoteNodeStatus.ts';
import {readRemoteNodeStatus} from '../src/core/remoteStatusClient.ts';

function fixture() {
  const dir=mkdtempSync(join(realpathSync(tmpdir()),'forgia-supervised-'));
  const db=openRemoteLocalDb(dir,'control');
  try {
    const store=new RemoteNodeStatus(db); store.register('pc');
    return {dir,node:store.issue('pc','node',120_000),op:store.issue('pc','operator',120_000)};
  } finally { db.close(); }
}

test('RC28 supervisor starts one host and agent, shuts down and resumes durable sequence', {timeout:20_000},async()=>{
  const {dir,node,op}=fixture();
  let port=0;
  try {
    for(let i=0;i<2;i++){
      const stop=new AbortController();
      let ready!: (p:number)=>void;
      const started=new Promise<number>(resolve=>{ready=resolve;});
      const run=runRemoteLocalSupervisor(dir,port,node.token,stop.signal,ready);
      try {
        port=await Promise.race([started,run.then(()=>{throw Error('Supervisor exited before ready');})]);
        assert.equal((await readRemoteNodeStatus(port,op.token)).online,true);
      } finally { stop.abort(); assert.equal(await run,'stopped'); }
      await assert.rejects(readRemoteNodeStatus(port,op.token));
    }
  } finally { rmSync(dir,{recursive:true,force:true}); }
});

test('RC29 supervisor fails closed for wrong role or revoked grant without ready signal', {timeout:20_000},async()=>{
  const {dir,node,op}=fixture();
  try {
    let ready=0;
    const signal=new AbortController().signal;
    assert.equal(await runRemoteLocalSupervisor(dir,0,op.token,signal,()=>{ready++;}),'denied');
    const db=openRemoteLocalDb(dir,'control');
    try { assert.equal(new RemoteNodeStatus(db).revoke(node.id),true); } finally { db.close(); }
    assert.equal(await runRemoteLocalSupervisor(dir,0,node.token,signal,()=>{ready++;}),'denied');
    assert.equal(ready,0);
  } finally { rmSync(dir,{recursive:true,force:true}); }
});

test('RC30 supervisor refuses occupied or gateway port, and pre-aborted start', {timeout:20_000},async()=>{
  const {dir,node}=fixture();
  const stop=new AbortController();
  const host=await startRemoteLocalHost(dir,0);
  try {
    const a=host.server.address(); assert.ok(a&&typeof a!=='string');
    await assert.rejects(runRemoteLocalSupervisor(dir,a.port,node.token,stop.signal));
    await assert.rejects(runRemoteLocalSupervisor(dir,8787,node.token,stop.signal));
    stop.abort();
    assert.equal(await runRemoteLocalSupervisor(dir,0,node.token,stop.signal),'stopped');
  } finally { await host.close(); rmSync(dir,{recursive:true,force:true}); }
});


test('RC64 supervisor refuses missing or uninitialized control state without bootstrap',async()=>{
  const dir=mkdtempSync(join(realpathSync(tmpdir()),'forgia-supervised-empty-'));
  const token='a'.repeat(64),signal=new AbortController().signal;
  try {
    await assert.rejects(runRemoteLocalSupervisor(dir,0,token,signal));
    assert.equal(existsSync(join(dir,'control.sqlite')),false);
    assert.equal(existsSync(join(dir,'agent.sqlite')),false);
    openRemoteLocalDb(dir,'control').close();
    await assert.rejects(runRemoteLocalSupervisor(dir,0,token,signal),/initialized control state/);
    const db=openRemoteLocalDb(dir,'control',true);
    try { assert.equal(db.prepare("SELECT 1 FROM sqlite_schema WHERE name='rc_nodes'").get(),undefined); }
    finally { db.close(); }
    assert.equal(existsSync(join(dir,'agent.sqlite')),false);
  } finally { rmSync(dir,{recursive:true,force:true}); }
});
