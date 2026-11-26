import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,realpathSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {NotificationPush} from '../server/notificationPush.ts';
import {NotificationHub} from '../server/notificationHub.ts';
import {NotificationLocalRuntime,openNotificationLocal} from '../server/notificationLocalRuntime.ts';
const project='demo/target',other='demo/other',wait=900000;
const binding={owner:'alice',pushToken:'ExpoPushToken[synthetic_fixture_only]',accessToken:'synthetic_access_secret_only',consentVerified:true as const,freeServiceVerified:true as const};
const event=(id:string,p=project)=>({version:1,id,source:'fixture',project:p,type:'ci.failed',severity:'warning',timestamp:1,correlation_id:id});
const fixture=()=>{const dir=mkdtempSync(join(realpathSync(tmpdir()),'forgia-push-'));return {dir,db:openNotificationLocal(dir,true)};};
const ok={status:200,body:'{"data":{"status":"ok","id":"fixture-ticket"}}'};
test('N10 ticket survives restart, scoped receipt required before next send, redacted payload',async()=>{
 const {dir,db}=fixture();let current=db;let calls:string[]=[];const requests:{op:string;token:string;body:string}[]=[];
 const transport:ConstructorParameters<typeof NotificationPush>[2]=async(op,token,body)=>{calls.push(op);requests.push({op,token,body});return op==='send'?ok:{status:200,body:'{"data":{"fixture-ticket":{"status":"ok"}}}'};};
 try{
  const push=new NotificationPush(db,binding,transport),rt=new NotificationLocalRuntime(db,'alice',project);
  assert.equal(await rt.deliverPush(binding,transport,()=>100),false);push.activate(0);
  const hub=new NotificationHub(db);hub.setPreference('alice',project,'push',true);hub.setPreference('alice',other,'push',true);
  hub.publish('alice',event('older',other),1);rt.publish(event('fixture-event'),2);rt.publish(event('second'),3);
  await assert.rejects(rt.deliverPush({...binding,owner:'bob'},transport,()=>100));
  assert.equal(await rt.deliverPush(binding,transport,()=>100),true);assert.equal(push.state().state,'receipt');
  db.close();current=openNotificationLocal(dir);
  const next=new NotificationLocalRuntime(current,'alice',project);
  assert.equal(await next.deliverPush(binding,transport,()=>100+wait),false);
  assert.equal(await new NotificationLocalRuntime(current,'alice',other).pollPushReceipt(binding,transport,()=>100+wait),false);
  assert.equal(await next.pollPushReceipt(binding,transport,()=>99+wait),false);
  assert.equal(await next.pollPushReceipt(binding,transport,()=>100+wait),true);
  assert.deepEqual(new NotificationPush(current,binding,transport).state(),{state:'active',lastReceipt:'handoff'});
  assert.equal(await next.deliverPush(binding,transport,()=>100+wait),true);
  assert.deepEqual(calls,['send','getReceipts','send']);
  for(const req of requests){
   assert.equal(req.token,binding.accessToken);
   assert.ok(!req.body.includes(project)&&!req.body.includes('fixture-event')&&!req.body.includes(binding.accessToken));
   assert.deepEqual(JSON.parse(req.body),req.op==='send'?{to:binding.pushToken,title:'Forgia',body:'CI fallita. Dettagli nella inbox.',ttl:3600}:{ids:['fixture-ticket']});
  }
 }finally{current.close();rmSync(dir,{recursive:true,force:true});}
});
test('N10 ambiguous send blocks persistently and cannot replay',async()=>{
 const {dir,db}=fixture();let calls=0;const transport=async()=>{calls++;throw Error('synthetic failure');};
 try{
  const push=new NotificationPush(db,binding,transport);push.activate(0);
  const hub=new NotificationHub(db);hub.setPreference('alice',project,'push',true);hub.publish('alice',event('one'),1);hub.publish('alice',event('two'),2);
  assert.equal(await push.runOnce(project,()=>100),true);assert.equal(push.state().state,'blocked');
  assert.equal(await new NotificationPush(db,binding,transport).runOnce(project,()=>100+wait),false);
  assert.equal(calls,1);
 }finally{db.close();rmSync(dir,{recursive:true,force:true});}
});
test('N10 unregistered receipt revokes all push preferences and backlog',async()=>{
 const {dir,db}=fixture();let calls=0;
 const transport:ConstructorParameters<typeof NotificationPush>[2]=async(op)=>{calls++;return op==='send'?ok:{status:200,body:'{"data":{"fixture-ticket":{"status":"error","details":{"error":"DeviceNotRegistered"}}}}'};};
 try{
  const push=new NotificationPush(db,binding,transport);push.activate(0);const hub=new NotificationHub(db);
  hub.setPreference('alice',project,'push',true);hub.setPreference('alice',other,'push',true);
  hub.publish('alice',event('one'),1);hub.publish('alice',event('two',other),2);
  await push.runOnce(project,()=>100);assert.equal(await push.pollReceipt(project,()=>100+wait),true);
  assert.equal(push.state().state,'revoked');assert.equal(await push.runOnce(other,()=>200+wait),false);assert.equal(calls,2);
  assert.ok(hub.outbox('alice').every(x=>x.state==='revoked'));
 }finally{db.close();rmSync(dir,{recursive:true,force:true});}
});
test('N10 empty receipt is throttled; revocation stops polling and send',async()=>{
 const {dir,db}=fixture();let calls=0;
 const transport:ConstructorParameters<typeof NotificationPush>[2]=async(op)=>{calls++;return op==='send'?ok:{status:200,body:'{"data":{}}'};};
 try{
  const push=new NotificationPush(db,binding,transport);push.activate(0);const hub=new NotificationHub(db);
  hub.setPreference('alice',project,'push',true);hub.publish('alice',event('one'),1);
  await push.runOnce(project,()=>100);
  assert.equal(await push.pollReceipt(project,()=>100+wait),false);
  assert.equal(await push.pollReceipt(project,()=>101+wait),false);
  hub.setPreference('alice',project,'push',false);
  assert.equal(await push.pollReceipt(project,()=>100+2*wait),false);assert.equal(calls,2);
  push.revoke();assert.equal(push.state().state,'revoked');assert.equal(await push.runOnce(project,()=>100+3*wait),false);
 }finally{db.close();rmSync(dir,{recursive:true,force:true});}
});

test('N10 cap survives reopen and only resets on a later UTC day',async()=>{
 const {dir,db}=fixture();let current=db;let sends=0;
 const transport:ConstructorParameters<typeof NotificationPush>[2]=async(op)=>{if(op==='send'){sends++;return ok;}return {status:200,body:'{"data":{"fixture-ticket":{"status":"ok"}}}'};};
 try{
  const push=new NotificationPush(db,binding,transport);push.activate(0);
  const hub=new NotificationHub(db);hub.setPreference('alice',project,'push',true);
  for(let i=0;i<21;i++)hub.publish('alice',event('cap-'+i),i+1);
  for(let i=0;i<20;i++){
   const at=100+i*wait;
   assert.equal(await push.runOnce(project,()=>at),true);
   assert.equal(await push.pollReceipt(project,()=>at+wait),true);
  }
  db.close();current=openNotificationLocal(dir);
  const next=new NotificationPush(current,binding,transport);
  assert.equal(await next.runOnce(project,()=>100+20*wait),false);assert.equal(sends,20);
  assert.equal(await next.runOnce(project,()=>86400000),true);assert.equal(sends,21);
 }finally{current.close();rmSync(dir,{recursive:true,force:true});}
});
test('N10 revoke and re-opt-in between delivery intent and provider intent cannot revive backlog',async()=>{
 const {dir,db}=fixture();let calls=0,ticks=0;
 const transport:ConstructorParameters<typeof NotificationPush>[2]=async()=>{calls++;return ok;};
 try{
  const push=new NotificationPush(db,binding,transport);push.activate(0);
  const hub=new NotificationHub(db);hub.setPreference('alice',project,'push',true);hub.publish('alice',event('stale'),1);
  const now=()=>{if(++ticks===4){hub.setPreference('alice',project,'push',false);hub.setPreference('alice',project,'push',true);}return 100;};
  assert.equal(await push.runOnce(project,now),true);assert.equal(calls,0);
  assert.equal(push.state().state,'active');assert.equal(await push.runOnce(project,()=>100+wait),false);
  assert.equal(hub.outbox('alice')[0].state,'revoked');
  hub.publish('alice',event('fresh'),200);
  assert.equal(await push.runOnce(project,()=>100+wait),true);assert.equal(calls,1);
 }finally{db.close();rmSync(dir,{recursive:true,force:true});}
});
