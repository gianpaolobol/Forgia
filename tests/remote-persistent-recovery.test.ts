import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {once} from 'node:events';
import {DatabaseSync} from 'node:sqlite';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {RemoteHeartbeatAgent} from '../server/remoteHeartbeatAgent.ts';
import {RemoteNodeStatus} from '../server/remoteNodeStatus.ts';

test('persistent remote diagnostic: lost response, dual database reopen, rotation and revocation',async()=>{
  const dir=mkdtempSync(join(tmpdir(),'forgia-remote-recovery-'));
  const controlPath=join(dir,'control.sqlite'),agentPath=join(dir,'agent.sqlite');
  let control=new DatabaseSync(controlPath),agentDb=new DatabaseSync(agentPath);
  let now=1000,store=new RemoteNodeStatus(control,()=>now);
  store.register('pc');store.register('other');
  const node=store.issue('pc','node',60000),operator=store.issue('pc','operator',60000);
  const other=store.issue('other','operator',60000);
  const key='recovery_fixture_001',secondKey='recovery_fixture_002';
  const first=store.requestSnapshot(operator.token,key);
  now=1100;
  const second=store.requestSnapshot(operator.token,secondKey);
  assert.notEqual(first.id,second.id);
  let lose=true;
  const sequences:number[]=[];
  // Synthetic HTTP receiver; actual agent, control store and both disk DBs.
  const server=createServer(async(req,res)=>{
    try{
      assert.equal(req.url,'/v1/heartbeat');assert.equal(req.method,'POST');
      const raw=[];for await(const chunk of req)raw.push(Buffer.from(chunk));
      const sequence=JSON.parse(Buffer.concat(raw).toString('utf8')).sequence;
      sequences.push(sequence);
      const result=store.heartbeat(req.headers.authorization!.slice(7),sequence);
      if(lose){lose=false;req.socket.destroy();return;}
      res.writeHead(200,{'Content-Type':'application/json; charset=utf-8'});res.end(JSON.stringify(result));
    }catch{res.writeHead(401);res.end();}
  });
  let agent:RemoteHeartbeatAgent|undefined;
  try{
    server.listen(0,'127.0.0.1');await once(server,'listening');
    const address=server.address();assert.ok(address&&typeof address!=='string');
    agent=new RemoteHeartbeatAgent(agentDb,address.port,node.token);
    now=2000;assert.equal(await agent.pulse(),'unavailable');
    assert.deepEqual(store.findSnapshot(operator.token,key),first);
    assert.equal(store.readSnapshot(operator.token,first.id).state,'done');
    assert.equal(store.readSnapshot(operator.token,second.id).state,'queued');
    await agent.stop();control.close();agentDb.close();
    control=new DatabaseSync(controlPath);agentDb=new DatabaseSync(agentPath);
    store=new RemoteNodeStatus(control,()=>now);
    agent=new RemoteHeartbeatAgent(agentDb,address.port,node.token);
    assert.deepEqual(store.requestSnapshot(operator.token,key),first);
    assert.deepEqual(store.findSnapshot(other.token,key),{id:null});
    now=3000;assert.equal(await agent.pulse(),'accepted');
    assert.deepEqual(sequences,[1,2]);
    assert.equal(store.readSnapshot(operator.token,first.id).sequence,1);
    assert.equal(store.readSnapshot(operator.token,second.id).sequence,2);
    const third=store.requestSnapshot(operator.token,'recovery_fixture_003');
    const replacement=store.issue('pc','node',60000);
    assert.equal(store.readSnapshot(operator.token,third.id).state,'cancelled');
    assert.equal(store.status(operator.token).online,false);
    assert.equal(await agent.pulse(),'denied');
    await agent.stop();agent=new RemoteHeartbeatAgent(agentDb,address.port,replacement.token);
    const fourth=store.requestSnapshot(operator.token,'recovery_fixture_004');
    now=4000;assert.equal(await agent.pulse(),'accepted');
    assert.equal(store.readSnapshot(operator.token,fourth.id).sequence,1);
    assert.equal(store.status(operator.token).online,true);
    store.revoke(operator.id);
    assert.throws(()=>store.findSnapshot(operator.token,key));
    store.revoke(replacement.id);
    assert.equal(await agent.pulse(),'denied');
    assert.deepEqual(sequences,[1,2,3,1,2]);
  }finally{
    await agent?.stop();if(server.listening){server.closeAllConnections();await new Promise<void>(resolve=>server.close(()=>resolve()));}
    control.close();agentDb.close();rmSync(dir,{recursive:true,force:true});
  }
});
