import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { NotificationHub } from '../server/notificationHub.ts';
import { NotificationDelivery } from '../server/notificationDelivery.ts';
import { NotificationTelegram } from '../server/notificationTelegram.ts';

const config={owner:'alice',chatId:123,token:'123:synthetic_only_not_a_real_token',consentVerified:true as const};
const project='example/private-project';
function event(id:string){return {version:1,id,source:'local',project,type:'ci.failed',severity:'warning',timestamp:100,correlation_id:id,evidence_url:'https://github.com/'+project+'/actions/runs/123'};}
const success={status:200,body:JSON.stringify({ok:true,result:{message_id:1,chat:{id:123,type:'private'}}})};
test('N5 explicit binding clears old consent, sends only redacted fresh opted-in event',async()=>{
  const db=new DatabaseSync(':memory:');
  try {
    const hub=new NotificationHub(db);
    hub.setPreference('alice',project,'telegram',true); hub.publish('alice',event('old'),10);
    let calls=0;
    const worker=new NotificationTelegram(db,config,async(path,body)=>{
      calls++; assert.equal(path,'/bot'+config.token+'/sendMessage');
      const p=JSON.parse(body); assert.equal(p.chat_id,123); assert.equal(p.allow_paid_broadcast,false);
      assert.equal(p.protect_content,true); assert.match(p.text,/CI fallita/);
      assert.ok(!body.includes(project)); assert.ok(!body.includes(config.token)); return success;
    });
    assert.equal(await worker.runOnce(()=>100),false); worker.activate();
    hub.publish('alice',event('without-opt-in'),20);
    hub.setPreference('alice',project,'telegram',true); hub.publish('alice',event('fresh'),30);
    hub.setPreference('bob',project,'telegram',true); hub.publish('bob',event('other'),40);
    assert.equal(await worker.runOnce(()=>100),true); assert.equal(await worker.runOnce(()=>2000),false);
    assert.equal(calls,1);
    const states=new NotificationDelivery(db).status('alice'); assert.equal(states.find(x=>x.id==='old')?.state,'revoked');
    assert.equal(states.find(x=>x.id==='fresh')?.state,'sent');
    assert.equal(new NotificationDelivery(db).status('bob')[0].state,'pending');
    assert.throws(()=>worker.activate()); assert.throws(()=>new NotificationTelegram(db,{...config,chatId:-1}));
  } finally {db.close();}
});
test('N5 429 pauses durably, uncertain delivery not replayed, recipient cannot be switched',async()=>{
  const dir=mkdtempSync(join(tmpdir(),'forgia-telegram-')); let db=new DatabaseSync(join(dir,'hub.sqlite'));
  try {
    let calls=0;
    const hub=new NotificationHub(db), worker=new NotificationTelegram(db,config,async()=>{calls++;return {status:429,body:'{"ok":false,"parameters":{"retry_after":60}}'};});
    worker.activate(); hub.setPreference('alice',project,'telegram',true); hub.publish('alice',event('first'),10);hub.publish('alice',event('next'),20);
    assert.equal(await worker.runOnce(()=>100),true); assert.equal(worker.state(),'paused');db.close();
    db=new DatabaseSync(join(dir,'hub.sqlite'));
    const resumed=new NotificationTelegram(db,config,async()=>{calls++;return success;});
    assert.equal(resumed.state(),'paused');assert.equal(await resumed.runOnce(()=>100_000),false);
    const other=new NotificationTelegram(db,{...config,chatId:456},async()=>{throw Error('unexpected');});
    assert.equal(other.state(),'inactive');assert.throws(()=>other.activate());assert.throws(()=>other.revoke());
    assert.throws(()=>resumed.resume(60_099));resumed.resume(60_100);assert.equal(await resumed.runOnce(()=>100_000),true);assert.equal(calls,2);
    const status=new NotificationDelivery(db).status('alice');
    assert.equal(status.find(x=>x.id==='first')?.state,'uncertain');assert.equal(status.find(x=>x.id==='next')?.state,'sent');
    resumed.revoke();assert.equal(resumed.state(),'revoked');assert.throws(()=>resumed.resume());
    assert.equal(await resumed.runOnce(()=>200_000),false);
  } finally {db.close();rmSync(dir,{recursive:true,force:true});}
});
test('N5 invalid success, redirect and transport exception never become sent or retry',async()=>{
  for(const transport of [
    async()=>({status:200,body:JSON.stringify({ok:true,result:{message_id:1,chat:{id:999,type:'private'}}})}),
    async()=>({status:302,body:''}),
    async()=>{throw new Error(config.token);}
  ]){
    const db=new DatabaseSync(':memory:');
    try{
      const hub=new NotificationHub(db), worker=new NotificationTelegram(db,config,transport);
      worker.activate();hub.setPreference('alice',project,'telegram',true);hub.publish('alice',event('one'),10);
      assert.equal(await worker.runOnce(()=>100),true);assert.equal(worker.state(),'paused');
      assert.equal(new NotificationDelivery(db).status('alice')[0].state,'uncertain');
      assert.equal(await worker.runOnce(()=>100_000),false);
    }finally{db.close();}
  }
});
test('N5 concurrent workers do not dispatch a second request while first is in flight',async()=>{
  const db=new DatabaseSync(':memory:');
  try{
    const hub=new NotificationHub(db);
    let release!:()=>void;const wait=new Promise<void>(resolve=>{release=resolve;});
    let calls=0;
    const a=new NotificationTelegram(db,config,async()=>{calls++;await wait;return success;});
    const b=new NotificationTelegram(db,config,async()=>{calls++;return success;});
    a.activate();hub.setPreference('alice',project,'telegram',true);hub.publish('alice',event('one'),10);hub.publish('alice',event('two'),20);
    const first=a.runOnce(()=>100);assert.equal(calls,1);
    try{await b.runOnce(()=>2000);assert.equal(calls,1);}finally{release();}
    assert.equal(await first,true);
    assert.equal(await b.runOnce(()=>40_000),true);assert.equal(calls,2);
  }finally{db.close();}
});

test('N5 send intent survives interruption and blocks resume or another send after lease expiry',async()=>{
  const dir=mkdtempSync(join(tmpdir(),'forgia-telegram-crash-'));
  const path=join(dir,'hub.sqlite');
  let db=new DatabaseSync(path);
  try{
    const hub=new NotificationHub(db);
    let calls=0;
    const worker=new NotificationTelegram(db,config,async()=>{calls++;return new Promise<never>(()=>{});});
    worker.activate();hub.setPreference('alice',project,'telegram',true);
    hub.publish('alice',event('one'),10);hub.publish('alice',event('two'),20);
    // Simulate loss of the process after the transport was invoked, without an outcome.
    void worker.runOnce(()=>100);
    assert.equal(calls,1);assert.equal(worker.state(),'paused');
    db.close();db=new DatabaseSync(path);
    const reopened=new NotificationTelegram(db,config,async()=>{calls++;return success;});
    assert.equal(reopened.state(),'paused');
    assert.throws(()=>reopened.resume(Number.MAX_SAFE_INTEGER));
    assert.equal(await reopened.runOnce(()=>200_000),false);
    assert.equal(calls,1);reopened.revoke();assert.equal(reopened.state(),'revoked');
  }finally{db.close();rmSync(dir,{recursive:true,force:true});}
});
test('N5 revocation during transport cannot be reversed by a success response',async()=>{
  const db=new DatabaseSync(':memory:');
  try{
    const hub=new NotificationHub(db);
    let release!:()=>void;const wait=new Promise<void>(resolve=>{release=resolve;});
    const a=new NotificationTelegram(db,config,async()=>{await wait;return success;});
    a.activate();hub.setPreference('alice',project,'telegram',true);hub.publish('alice',event('one'),10);
    const sending=a.runOnce(()=>100);assert.equal(a.state(),'paused');
    a.revoke();release();assert.equal(await sending,true);
    assert.equal(a.state(),'revoked');assert.equal(await a.runOnce(()=>2000),false);
  }finally{db.close();}
});
