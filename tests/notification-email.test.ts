import {test} from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {NotificationHub} from '../server/notificationHub.ts';
import {NotificationDelivery} from '../server/notificationDelivery.ts';
import {NotificationEmail} from '../server/notificationEmail.ts';
const cfg={owner:'alice',sender:'sender@example.invalid',recipient:'recipient@example.invalid',
  apiKey:'synthetic_not_a_real_key',consentVerified:true as const,dedicatedFreeAccountVerified:true as const,dailyCap:1};
const project='example/private';
const event=(id:string)=>({version:1,id,source:'local',project,type:'ci.failed',severity:'warning',timestamp:1,correlation_id:id,evidence_url:'https://github.com/'+project+'/actions/runs/123'});
const ok={status:201,body:JSON.stringify({messageId:'<synthetic@example.invalid>'})};
test('N6 dedicated opt-in, redacted single recipient, cap survives restart and clock rollback',async()=>{
  const dir=mkdtempSync(join(tmpdir(),'forgia-email-'));const path=join(dir,'hub.sqlite');let db=new DatabaseSync(path);
  try{
    const hub=new NotificationHub(db);hub.setPreference('alice',project,'email',true);hub.publish('alice',event('old'),1);
    let calls=0;
    const transport=async(key:string,body:string)=>{calls++;assert.equal(key,cfg.apiKey);const p=JSON.parse(body);
      assert.deepEqual(p.to,[{email:cfg.recipient}]);assert.deepEqual(p.sender,{email:cfg.sender});
      assert.match(p.textContent,/CI fallita/);assert.ok(!body.includes(project));assert.ok(!body.includes(key));return ok;};
    const a=new NotificationEmail(db,cfg,transport);
    assert.equal(await a.runOnce(()=>100),false);a.activate(100);
    hub.publish('alice',event('no-consent'),2);hub.setPreference('alice',project,'email',true);
    hub.publish('alice',event('one'),3);hub.publish('alice',event('two'),4);
    hub.setPreference('bob',project,'email',true);hub.publish('bob',event('other'),5);
    assert.equal(await a.runOnce(()=>100),true);assert.equal(calls,1);db.close();db=new DatabaseSync(path);
    const b=new NotificationEmail(db,cfg,transport);
    assert.equal(await b.runOnce(()=>2000),false);assert.equal(await b.runOnce(()=>86_400_100),true);
    assert.equal(await b.runOnce(()=>100),false);assert.equal(calls,2);
    const states=new NotificationDelivery(db).status('alice');
    assert.equal(states.find(x=>x.id==='old')?.state,'revoked');assert.equal(states.find(x=>x.id==='one')?.state,'sent');
    assert.equal(states.find(x=>x.id==='two')?.state,'sent');assert.equal(new NotificationDelivery(db).status('bob')[0].state,'pending');
    assert.throws(()=>b.activate());const other=new NotificationEmail(db,{...cfg,recipient:'other@example.invalid'},transport);
    assert.equal(other.state(),'inactive');assert.throws(()=>other.revoke());
    assert.throws(()=>new NotificationEmail(db,{...cfg,dailyCap:21},transport));
  }finally{db.close();rmSync(dir,{recursive:true,force:true});}
});
test('N6 provider errors, invalid success and timeout block permanently without retry',async()=>{
  for(const transport of [async()=>({status:429,body:''}),async()=>({status:401,body:''}),
    async()=>({status:201,body:'{}'}),async()=>({status:302,body:''}),async()=>{throw new Error(cfg.apiKey);}]){
    const db=new DatabaseSync(':memory:');try{
      const hub=new NotificationHub(db),a=new NotificationEmail(db,cfg,transport);
      a.activate(0);hub.setPreference('alice',project,'email',true);hub.publish('alice',event('one'),1);
      assert.equal(await a.runOnce(()=>100),true);assert.equal(a.state(),'blocked');
      assert.equal(new NotificationDelivery(db).status('alice')[0].state,'uncertain');
      assert.equal(await a.runOnce(()=>86_400_000),false);a.revoke();assert.equal(a.state(),'revoked');
    }finally{db.close();}
  }
});
test('N6 concurrent worker cannot send while intent is outstanding and revoke wins',async()=>{
  const db=new DatabaseSync(':memory:');try{
    const hub=new NotificationHub(db);let release!:()=>void;const wait=new Promise<void>(r=>{release=r;});let calls=0;
    const a=new NotificationEmail(db,cfg,async()=>{calls++;await wait;return ok;});
    const b=new NotificationEmail(db,cfg,async()=>{calls++;return ok;});
    a.activate(0);hub.setPreference('alice',project,'email',true);hub.publish('alice',event('one'),1);hub.publish('alice',event('two'),2);
    const pending=a.runOnce(()=>100);assert.equal(a.state(),'blocked');
    try{assert.equal(await b.runOnce(()=>86_400_000),false);assert.equal(calls,1);b.revoke();}finally{release();}
    assert.equal(await pending,true);assert.equal(a.state(),'revoked');
  }finally{db.close();}
});
test('N6 crash after reservation stays blocked across restart and next UTC day',async()=>{
  const dir=mkdtempSync(join(tmpdir(),'forgia-email-crash-'));const path=join(dir,'hub.sqlite');let db=new DatabaseSync(path);
  try{
    const hub=new NotificationHub(db);let calls=0;
    const a=new NotificationEmail(db,cfg,async()=>{calls++;return new Promise<never>(()=>{});});
    a.activate(0);hub.setPreference('alice',project,'email',true);hub.publish('alice',event('one'),1);
    void a.runOnce(()=>100);assert.equal(a.state(),'blocked');assert.equal(calls,1);db.close();db=new DatabaseSync(path);
    const b=new NotificationEmail(db,cfg,async()=>{calls++;return ok;});
    assert.equal(b.state(),'blocked');assert.equal(await b.runOnce(()=>86_400_000),false);assert.equal(calls,1);
  }finally{db.close();rmSync(dir,{recursive:true,force:true});}
});
