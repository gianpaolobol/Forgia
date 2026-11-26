import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync,realpathSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {openNotificationLocal,NotificationLocalRuntime} from '../server/notificationLocalRuntime.ts';
import {NotificationHub} from '../server/notificationHub.ts';
import {NotificationEmail} from '../server/notificationEmail.ts';
import {NotificationTelegram} from '../server/notificationTelegram.ts';
import {NotificationDelivery} from '../server/notificationDelivery.ts';

const project='demo/target',other='demo/other';
const event=(id:string,p=project)=>({version:1,id,source:'fixture',project:p,type:'ci.failed',severity:'warning',timestamp:1,correlation_id:id});
const email={owner:'alice',sender:'sender@example.invalid',recipient:'recipient@example.invalid',apiKey:'synthetic_only_not_a_key',consentVerified:true as const,dedicatedFreeAccountVerified:true as const,dailyCap:3};
const telegram={owner:'alice',chatId:123,token:'123:synthetic_only_not_a_token',consentVerified:true as const};
const fixture=()=>{const dir=mkdtempSync(join(realpathSync(tmpdir()),'forgia-scoped-'));return {dir,db:openNotificationLocal(dir,true)};};
test('N9 email scoped runtime never claims older event in other project or tenant; survives restart',async()=>{
 const {dir,db}=fixture();let current=db;let sends=0;
 const transport=async()=>{sends++;return {status:201,body:'{"messageId":"<fixture@example.invalid>"}'};};
 try{
  new NotificationEmail(db,email,transport).activate(0);const hub=new NotificationHub(db);
  for(const [owner,p] of [['alice',other],['alice',project],['bob',project]])hub.setPreference(owner!,p!,'email',true);
  hub.publish('alice',event('older',other),1);hub.publish('bob',event('foreign'),2);hub.publish('alice',event('target'),3);
  const runtime=new NotificationLocalRuntime(db,'alice',project);
  await assert.rejects(runtime.deliverEmail({...email,owner:'bob'},transport,()=>100));
  assert.equal(await runtime.deliverEmail(email,transport,()=>100),true);
  assert.equal(sends,1);assert.equal(runtime.snapshot().delivery[0]?.state,'sent');
  assert.equal(new NotificationLocalRuntime(db,'alice',other).snapshot().delivery[0]?.state,'pending');
  assert.equal(new NotificationLocalRuntime(db,'bob',project).snapshot().delivery[0]?.state,'pending');
  db.close();current=openNotificationLocal(dir);
  assert.equal(await new NotificationLocalRuntime(current,'alice',project).deliverEmail(email,transport,()=>2100),false);assert.equal(sends,1);
 }finally{current.close();rmSync(dir,{recursive:true,force:true});}
});
test('N9 Telegram requires explicit binding, activation and per-project consent; revoke blocks next delivery',async()=>{
 const {dir,db}=fixture();let sends=0;
 const transport=async()=>{sends++;return {status:200,body:'{"ok":true,"result":{"message_id":1,"chat":{"id":123,"type":"private"}}}'};};
 try{
  const runtime=new NotificationLocalRuntime(db,'alice',project);
  assert.equal(await runtime.deliverTelegram(telegram,transport,()=>100),false);
  await assert.rejects(runtime.deliverTelegram({...telegram,owner:'bob'},transport,()=>100));
  new NotificationTelegram(db,telegram,transport).activate();
  const hub=new NotificationHub(db);hub.setPreference('alice',project,'telegram',true);hub.setPreference('alice',other,'telegram',true);
  hub.publish('alice',event('older',other),1);runtime.publish(event('one'),2);runtime.publish(event('two'),3);
  assert.equal(await runtime.deliverTelegram(telegram,transport,()=>100),true);
  runtime.revoke('telegram');
  assert.equal(await runtime.deliverTelegram(telegram,transport,()=>2100),false);
  assert.equal(sends,1);
  assert.deepEqual(runtime.snapshot().delivery.map(x=>x.state),['revoked','sent']);
  assert.equal(new NotificationLocalRuntime(db,'alice',other).snapshot().delivery[0]?.state,'pending');
 }finally{db.close();rmSync(dir,{recursive:true,force:true});}
});
test('N9 scoped claim validates project and retains global owner/channel pacing',async()=>{
 const {dir,db}=fixture();
 try{
  const hub=new NotificationHub(db),worker=new NotificationDelivery(db);
  hub.setPreference('alice',project,'push',true);hub.setPreference('alice',other,'push',true);
  hub.publish('alice',event('older',other),1);hub.publish('alice',event('target'),2);
  assert.throws(()=>worker.claim('alice','push',100,'demo/..'));
  const c=worker.claim('alice','push',100,project)!;assert.equal(c.id,'target');
  assert.equal(worker.begin(c,100)?.project,project);worker.finish(c,'sent',101);
  assert.equal(worker.claim('alice','push',200,other),null);
  assert.equal(worker.claim('alice','push',1200,other)?.id,'older');
 }finally{db.close();rmSync(dir,{recursive:true,force:true});}
});
