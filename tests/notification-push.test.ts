import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,realpathSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {NotificationPush} from '../server/notificationPush.ts';
import {NotificationHub} from '../server/notificationHub.ts';
import {NotificationLocalRuntime,openNotificationLocal} from '../server/notificationLocalRuntime.ts';
const project='demo/target',other='demo/other',wait=900000;
const binding={owner:'alice',pushToken:'ExpoPushToken[synthetic_fixture_only]',accessToken:'synthetic_fixture_only',consentVerified:true as const,freeServiceVerified:true as const};
const event=(id:string,p=project)=>({version:1,id,source:'fixture',project:p,type:'ci.failed',severity:'warning',timestamp:1,correlation_id:id});
const fixture=()=>{const dir=mkdtempSync(join(realpathSync(tmpdir()),'forgia-push-'));return {dir,db:openNotificationLocal(dir,true)};};
const ok={status:200,body:'{"data":{"status":"ok","id":"fixture-ticket"}}'};
test('N10 ticket survives restart, scoped receipt required before next send, redacted payload',async()=>{
 const {dir,db}=fixture();let current=db;let calls:string[]=[];
 const transport:ConstructorParameters<typeof NotificationPush>[2]=async(op,_token,body)=>{calls.push(op);if(op==='send'){assert.equal(JSON.parse(body).to,binding.pushToken);assert.ok(!body.includes(project)&&!body.includes('fixture-event')&&!body.includes(binding.accessToken));return ok;}assert.deepEqual(JSON.parse(body),{ids:['fixture-ticket']});return {status:200,body:'{"data":{"fixture-ticket":{"status":"ok"}}}'};};
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
