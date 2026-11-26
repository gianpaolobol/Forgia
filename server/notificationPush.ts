import {DatabaseSync} from 'node:sqlite';
import {createHash} from 'node:crypto';
import {request} from 'node:https';
import {NotificationHub,normalizeNotification} from './notificationHub.ts';
import {NotificationDelivery} from './notificationDelivery.ts';

type Binding={owner:string;pushToken:string;accessToken:string;consentVerified:true;freeServiceVerified:true};
type Reply={status:number;body:string};
type Operation='send'|'getReceipts';
type Transport=(operation:Operation,accessToken:string,body:string)=>Promise<Reply>;
const MAX=65536, WAIT=15*60_000, DAY=86400000;
const ticketId=(x:unknown):x is string=>typeof x==='string'&&/^[a-zA-Z0-9_-]{1,128}$/.test(x);
function clock(now:number){if(!Number.isSafeInteger(now)||now<0||now>Number.MAX_SAFE_INTEGER-DAY)throw Error('Invalid clock');return now;}
function projectScope(project:string){normalizeNotification({version:1,id:'scope',source:'scope',project,type:'task.updated',severity:'info',timestamp:0,correlation_id:'scope'});}
function pin(b:Binding){
 if(!b||typeof b.owner!=='string'||!/^[a-zA-Z0-9_-]{1,96}$/.test(b.owner)||
 typeof b.pushToken!=='string'||!/^(?:Expo|Exponent)PushToken\[[a-zA-Z0-9_-]{16,128}\]$/.test(b.pushToken)||
 typeof b.accessToken!=='string'||!/^[a-zA-Z0-9_-]{16,512}$/.test(b.accessToken)||
 b.consentVerified!==true||b.freeServiceVerified!==true)throw Error('Invalid push binding');
 return createHash('sha256').update(JSON.stringify([b.owner,b.pushToken,b.accessToken])).digest('hex');
}
function atomic<T>(db:DatabaseSync,fn:()=>T):T{db.exec('BEGIN IMMEDIATE');try{const result=fn();db.exec('COMMIT');return result;}catch(e){db.exec('ROLLBACK');throw e;}}
// Explicit transport only. Never call with live credentials before device pairing, vault and RV-01.
export function sendExpoPush(operation:Operation,accessToken:string,body:string):Promise<Reply>{
 if(operation!=='send'&&operation!=='getReceipts')throw Error('Invalid push operation');
 return new Promise((resolve,reject)=>{
  const req=request({hostname:'exp.host',port:443,path:'/--/api/v2/push/'+operation,method:'POST',
   rejectUnauthorized:true,agent:false,headers:{Authorization:'Bearer '+accessToken,'Content-Type':'application/json',Accept:'application/json','Content-Length':Buffer.byteLength(body)}},res=>{
   let size=0;const chunks:Buffer[]=[];
   res.on('data',(chunk:Buffer)=>{size+=chunk.length;if(size>MAX){res.destroy();req.destroy();reject(Error('Push response limit'));return;}chunks.push(chunk);});
   res.on('error',()=>reject(Error('Push response error')));res.on('aborted',()=>reject(Error('Push response aborted')));
   res.on('end',()=>resolve({status:res.statusCode??0,body:Buffer.concat(chunks).toString('utf8')}));
  });
  const timer=setTimeout(()=>{req.destroy();reject(Error('Push timeout'));},10_000);
  req.on('error',()=>reject(Error('Push transport error')));req.on('close',()=>clearTimeout(timer));req.end(body);
 });
}
function parsed(reply:Reply){
 if(reply.status!==200||typeof reply.body!=='string'||Buffer.byteLength(reply.body)>MAX)throw Error('Invalid push response');
 const p=JSON.parse(reply.body);if(!p||typeof p!=='object'||(p.errors!==undefined&&(!Array.isArray(p.errors)||p.errors.length)))throw Error('Invalid push response');return p.data;
}
// One dedicated owner/device per private DB. Only one unresolved ticket at a time.
// Provider acceptance and APNs/FCM handoff are not evidence of device display.
export class NotificationPush{
 private db:DatabaseSync;private binding:Binding;private digest:string;private transport:Transport;private delivery:NotificationDelivery;
 constructor(db:DatabaseSync,binding:Binding,transport:Transport){
  this.digest=pin(binding);if(typeof transport!=='function')throw Error('Explicit push transport required');
  this.db=db;this.binding={...binding};this.transport=transport;new NotificationHub(db);this.delivery=new NotificationDelivery(db);
  db.exec(`CREATE TABLE IF NOT EXISTS notification_push_binding(
    singleton INTEGER PRIMARY KEY CHECK(singleton=1),owner TEXT NOT NULL,digest TEXT NOT NULL,
    state TEXT NOT NULL CHECK(state IN ('active','blocked','receipt','revoked')),
    ticket TEXT,project TEXT,created INTEGER NOT NULL,next_poll INTEGER NOT NULL,utc_day INTEGER NOT NULL,attempts INTEGER NOT NULL,
    last_receipt TEXT NOT NULL CHECK(last_receipt IN ('none','handoff','error','unknown')))`);
 }
 private row(){return this.db.prepare('SELECT * FROM notification_push_binding WHERE singleton=1 AND owner=? AND digest=?').get(this.binding.owner,this.digest);}
 private clearConsent(){
  this.db.prepare("UPDATE notification_preferences SET enabled=0 WHERE owner=? AND channel='push'").run(this.binding.owner);
  this.db.prepare("UPDATE notification_outbox SET state='revoked' WHERE owner=? AND channel='push' AND state='pending'").run(this.binding.owner);
 }
 activate(now=Date.now()){
  clock(now);atomic(this.db,()=>{if(this.db.prepare('SELECT singleton FROM notification_push_binding').get())throw Error('Push binding already initialized');
   this.db.prepare("INSERT INTO notification_push_binding VALUES(1,?,?,'active',NULL,NULL,0,0,?,0,'none')").run(this.binding.owner,this.digest,Math.floor(now/DAY));this.clearConsent();});
 }
 state(){const r=this.row();return {state:r?String(r.state):'inactive',lastReceipt:r?String(r.last_receipt):'none'};}
 revoke(){
  atomic(this.db,()=>{if(!this.row())throw Error('Push binding mismatch');this.db.prepare("UPDATE notification_push_binding SET state='revoked',ticket=NULL,project=NULL WHERE singleton=1").run();this.clearConsent();});
 }
 private reserve(project:string,source:string,id:string,now:number){
  clock(now);const day=Math.floor(now/DAY);
  return atomic(this.db,()=>{
   const r=this.row();if(!r||r.state!=='active'||day<Number(r.utc_day)||(day===Number(r.utc_day)&&Number(r.attempts)>=20))return false;
   // Recheck the exact event and consent in the same transaction as provider intent.
   // A revoke/re-opt-in between delivery.begin and this reservation cannot revive backlog.
   const consent=this.db.prepare(`SELECT 1 FROM notification_outbox o JOIN notification_preferences p
     ON p.owner=o.owner AND p.project=o.project AND p.channel=o.channel
     WHERE o.owner=? AND o.project=? AND o.source=? AND o.id=? AND o.channel='push' AND o.state='pending' AND p.enabled=1`)
     .get(this.binding.owner,project,source,id);
   if(!consent)return false;
   return this.db.prepare("UPDATE notification_push_binding SET state='blocked',project=?,ticket=NULL,created=?,next_poll=0,attempts=CASE WHEN utc_day=? THEN attempts+1 ELSE 1 END,utc_day=?,last_receipt='unknown' WHERE singleton=1 AND digest=? AND state='active'").run(project,now,day,day,this.digest).changes===1;
  });
 }
 private invalidDevice(){
  atomic(this.db,()=>{const r=this.row();if(!r||r.state==='revoked')return;this.db.prepare("UPDATE notification_push_binding SET state='revoked',ticket=NULL,project=NULL,last_receipt='error' WHERE singleton=1 AND digest=?").run(this.digest);this.clearConsent();});
 }
 async runOnce(project:string,now=Date.now){
  projectScope(project);const r=this.row(),day=Math.floor(clock(now())/DAY);
  if(!r||r.state!=='active'||day<Number(r.utc_day)||(day===Number(r.utc_day)&&Number(r.attempts)>=20))return false;
  return this.delivery.runOnce(this.binding.owner,'push',async d=>{
   if(!this.reserve(d.project,d.event.source,d.event.id,now()))return 'not-sent';
   try{
    const payload=JSON.stringify({to:this.binding.pushToken,title:'Forgia',body:d.event.summary+'. Dettagli nella inbox.',ttl:3600});
    const raw=parsed(await this.transport('send',this.binding.accessToken,payload));
    const t=Array.isArray(raw)&&raw.length===1?raw[0]:raw;
    if(t?.status==='error'&&t.details?.error==='DeviceNotRegistered'){this.invalidDevice();return 'not-sent';}
    if(t?.status==='ok'&&ticketId(t.id)){
     const observed=clock(now());
     this.db.prepare("UPDATE notification_push_binding SET state='receipt',ticket=?,next_poll=? WHERE singleton=1 AND digest=? AND state='blocked'").run(t.id,observed+WAIT,this.digest);
     return 'sent';
    }
   }catch{/* ambiguous outcome: remain durably blocked, never replay */}
   return 'uncertain';
  },now,project);
 }
 // Explicit scoped polling, at most once per 15 minutes, without resending.
 async pollReceipt(project:string,now=Date.now){
  projectScope(project);const at=clock(now());
  const ticket=atomic(this.db,()=>{
   const r=this.row();if(!r||r.state!=='receipt'||r.project!==project||!ticketId(r.ticket)||at<Number(r.next_poll))return null;
   if(at-Number(r.created)>=DAY){
    this.db.prepare("UPDATE notification_push_binding SET state='blocked',ticket=NULL,last_receipt='unknown' WHERE singleton=1 AND digest=?").run(this.digest);return null;
   }
   const pref=this.db.prepare("SELECT enabled FROM notification_preferences WHERE owner=? AND project=? AND channel='push'").get(this.binding.owner,project);
   if(pref?.enabled!==1)return null;
   this.db.prepare("UPDATE notification_push_binding SET next_poll=? WHERE singleton=1 AND digest=?").run(at+WAIT,this.digest);return r.ticket;
  });
  if(!ticket)return false;
  try{
   const data=parsed(await this.transport('getReceipts',this.binding.accessToken,JSON.stringify({ids:[ticket]})));
   const receipt=data&&typeof data==='object'&&Object.hasOwn(data,ticket)?data[ticket]:undefined;
   if(!receipt)return false; // no receipt yet; no resend, wait until next poll
   if(receipt.status==='error'&&receipt.details?.error==='DeviceNotRegistered'){this.invalidDevice();return true;}
   if(receipt.status!=='ok'&&receipt.status!=='error')return false;
   return atomic(this.db,()=>{
    const pref=this.db.prepare("SELECT enabled FROM notification_preferences WHERE owner=? AND project=? AND channel='push'").get(this.binding.owner,project);
    const good=receipt.status==='ok'&&pref?.enabled===1;
    return this.db.prepare("UPDATE notification_push_binding SET state=?,ticket=NULL,project=NULL,last_receipt=? WHERE singleton=1 AND digest=? AND state='receipt' AND ticket=?")
     .run(good?'active':'blocked',receipt.status==='ok'?'handoff':'error',this.digest,ticket).changes===1;
   });
  }catch{return false;}
 }
}
