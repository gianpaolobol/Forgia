import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync,realpathSync,chmodSync,symlinkSync,writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {spawnSync} from 'node:child_process';
import {openNotificationLocal,NotificationLocalRuntime} from '../server/notificationLocalRuntime.ts';
import {NotificationHub} from '../server/notificationHub.ts';
import {NotificationEmail} from '../server/notificationEmail.ts';
const project='demo/project',HOUR=3600000;
const event=(id:string,p=project)=>({version:1,id,source:'fixture',project:p,type:'ci.failed',
  severity:'warning',timestamp:1,correlation_id:id});
function directory(){return mkdtempSync(join(realpathSync(tmpdir()),'forgia-notification-local-'));}
test('N7 local runtime integrates native ingress, inbox and digest across restart',()=>{
  const dir=directory();let db=openNotificationLocal(dir,true);
  try{
    const a=new NotificationLocalRuntime(db,'alice',project);
    const b=new NotificationLocalRuntime(db,'bob',project);
    const other=new NotificationLocalRuntime(db,'alice','demo/other');
    a.schedule(60,1);a.publish(event('one'),2);b.publish(event('foreign'),3);
    other.publish(event('other','demo/other'),4);
    assert.throws(()=>a.publish(event('wrong','demo/other'),5));
    assert.equal(a.publish(event('one'),6).duplicate,true);
    assert.equal(a.markRead('fixture','foreign',7),false);
    assert.equal(a.markRead('fixture','other',7),false);
    assert.equal(a.markRead('fixture','one',7),true);
    assert.equal(a.snapshot(true).events.length,0);
    assert.equal(a.snapshot().total,1);
    assert.equal(a.tick(HOUR)?.total,1);
    db.close();db=openNotificationLocal(dir);
    const reopened=new NotificationLocalRuntime(db,'alice',project);
    assert.equal(reopened.snapshot().digests.length,1);
    assert.equal(reopened.tick(HOUR),null);
    assert.equal(reopened.snapshot().unread,0);
    assert.equal(reopened.snapshot().channels.every(x=>!x.transportActive),true);
  }finally{db.close();rmSync(dir,{recursive:true,force:true});}
});
test('N7 local projection reports synthetic provider acceptance and revocation without cross-project leakage',async()=>{
  const dir=directory();const db=openNotificationLocal(dir,true);
  try{
    const a=new NotificationLocalRuntime(db,'alice',project),h=new NotificationHub(db);
    const mail=new NotificationEmail(db,{owner:'alice',sender:'sender@example.invalid',
      recipient:'recipient@example.invalid',apiKey:'synthetic_only_not_a_key',consentVerified:true,
      dedicatedFreeAccountVerified:true,dailyCap:2},async()=>({status:201,body:'{"messageId":"<fixture@example.invalid>"}'}));
    mail.activate(0);h.setPreference('alice',project,'email',true);
    a.publish(event('one'),1);a.publish(event('two'),2);
    h.setPreference('alice','demo/other','email',true);
    h.publish('alice',event('other','demo/other'),3);
    assert.equal(await mail.runOnce(()=>100),true);
    a.revoke('email');
    const view=a.snapshot();
    assert.equal(view.channels[0].preferenceEnabled,false);
    assert.deepEqual(view.delivery.map(x=>[x.state,x.count]),[['revoked',1],['sent',1]]);
    assert.equal(view.total,2);
    assert.equal(new NotificationLocalRuntime(db,'alice','demo/other').snapshot().channels[0].preferenceEnabled,true);
    assert.ok(!JSON.stringify(view).includes('example.invalid'));
  }finally{db.close();rmSync(dir,{recursive:true,force:true});}
});
test('N7 private archive rejects absent, duplicate initialization, insecure permissions and symlink sidecars',()=>{
  const dir=directory();
  try{
    assert.throws(()=>openNotificationLocal(dir));
    openNotificationLocal(dir,true).close();
    assert.throws(()=>openNotificationLocal(dir,true));
    chmodSync(join(dir,'notifications.sqlite'),0o644);
    assert.throws(()=>openNotificationLocal(dir));
    chmodSync(join(dir,'notifications.sqlite'),0o600);
    const target=join(dir,'target');writeFileSync(target,'fixture',{mode:0o600});
    symlinkSync(target,join(dir,'notifications.sqlite-journal'));
    assert.throws(()=>openNotificationLocal(dir));
  }finally{rmSync(dir,{recursive:true,force:true});}
});
test('N7 real local CLI processes publish, read, revoke and reopen without network',()=>{
  const dir=directory();
  const run=(args:string[],input?:string)=>spawnSync(process.execPath,
    ['--experimental-strip-types','scripts/notification-local.ts',...args],{encoding:'utf8',input,timeout:15000});
  const scope=[dir,'alice',project];
  try{
    assert.equal(run(['init',dir]).status,0);
    assert.equal(run(['publish',...scope],JSON.stringify(event('one'))).status,0);
    const view=run(['inbox',...scope]);assert.equal(view.status,0,view.stderr);
    assert.equal(JSON.parse(view.stdout).unread,1);
    assert.equal(run(['read',...scope,'fixture','one']).status,0);
    assert.equal(JSON.parse(run(['unread',...scope]).stdout).events.length,0);
    assert.equal(run(['revoke',...scope,'email']).status,0);
    assert.notEqual(run(['publish',...scope],JSON.stringify(event('wrong','demo/other'))).status,0);
    assert.notEqual(run(['init',dir]).status,0);
  }finally{rmSync(dir,{recursive:true,force:true});}
});
