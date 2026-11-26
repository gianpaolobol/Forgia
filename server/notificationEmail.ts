import { DatabaseSync } from 'node:sqlite';
import { createHash } from 'node:crypto';
import { request } from 'node:https';
import { NotificationDelivery } from './notificationDelivery.ts';
import { NotificationHub } from './notificationHub.ts';

type Binding = { owner: string; sender: string; recipient: string; apiKey: string;
  consentVerified: true; dedicatedFreeAccountVerified: true; dailyCap: number };
type Reply = { status: number; body: string };
type Transport = (apiKey: string, body: string) => Promise<Reply>;
const MAX_BODY=64*1024, DAY=86_400_000;
const address=(s:unknown):s is string=>typeof s==='string' && s.length<=254 &&
  /^[a-zA-Z0-9._+%-]+@[a-zA-Z0-9-]+(?:\.[a-zA-Z0-9-]+)+$/.test(s);
function fingerprint(b: Binding) {
  if(!b || typeof b.owner!=='string' || !/^[a-zA-Z0-9_-]{1,96}$/.test(b.owner) ||
    !address(b.sender) || !address(b.recipient) || typeof b.apiKey!=='string' ||
    !/^[a-zA-Z0-9_-]{16,256}$/.test(b.apiKey) || b.consentVerified!==true ||
    b.dedicatedFreeAccountVerified!==true || !Number.isInteger(b.dailyCap) || b.dailyCap<1 || b.dailyCap>20)
    throw new Error('Invalid email binding');
  return createHash('sha256').update(JSON.stringify([b.owner,b.sender,b.recipient,b.apiKey,b.dailyCap])).digest('hex');
}
function atomic<T>(db:DatabaseSync, fn:()=>T):T {
  db.exec('BEGIN IMMEDIATE');
  try {const v=fn();db.exec('COMMIT');return v;} catch(e){db.exec('ROLLBACK');throw e;}
}
function day(now:number) {
  if(!Number.isSafeInteger(now) || now<0 || now>Number.MAX_SAFE_INTEGER-600_000) throw new Error('Invalid clock');
  return Math.floor(now/DAY);
}
// Official endpoint only. Explicit injection into the worker is required.
// Do not wire this transport to a live runtime until account/consent/vault/review gates pass.
export function sendBrevoEmail(apiKey:string, body:string):Promise<Reply> {
  return new Promise((resolve,reject)=>{
    const req=request({hostname:'api.brevo.com',port:443,path:'/v3/smtp/email',method:'POST',
      rejectUnauthorized:true,agent:false,headers:{'api-key':apiKey,'Content-Type':'application/json',
        Accept:'application/json','Content-Length':Buffer.byteLength(body)}},res=>{
      const chunks:Buffer[]=[];let bytes=0;
      res.on('data',(chunk:Buffer)=>{bytes+=chunk.length;if(bytes>MAX_BODY){res.destroy();req.destroy();reject(new Error('Email response limit'));return;}chunks.push(chunk);});
      res.on('error',()=>reject(new Error('Email response error')));
      res.on('aborted',()=>reject(new Error('Email response aborted')));
      res.on('end',()=>resolve({status:res.statusCode??0,body:Buffer.concat(chunks).toString('utf8')}));
    });
    const deadline=setTimeout(()=>{req.destroy();reject(new Error('Email timeout'));},10_000);
    req.on('error',()=>reject(new Error('Email transport error')));
    req.on('close',()=>clearTimeout(deadline));req.end(body);
  });
}
// Local trusted administration only. Flags are attestations, not verified account
// metadata or recipient authentication. No default live transport or automatic resume.
// One dedicated sender/account/recipient per database; cap counts attempts, not successes.
export class NotificationEmail {
  private db:DatabaseSync;
  private delivery:NotificationDelivery;
  private binding:Binding;
  private digest:string;
  private transport:Transport;
  private busy=false;
  constructor(db:DatabaseSync,binding:Binding,transport:Transport) {
    this.digest=fingerprint(binding);
    if(typeof transport!=='function') throw new Error('Explicit email transport required');
    this.db=db;this.binding={...binding};this.transport=transport;
    new NotificationHub(db);this.delivery=new NotificationDelivery(db);
    db.exec(`CREATE TABLE IF NOT EXISTS notification_email_binding (
      singleton INTEGER PRIMARY KEY CHECK(singleton=1), owner TEXT NOT NULL,digest TEXT NOT NULL,
      state TEXT NOT NULL CHECK(state IN ('active','blocked','revoked')),
      utc_day INTEGER NOT NULL, attempts INTEGER NOT NULL)`);
  }
  private clearConsent(){
    this.db.prepare("UPDATE notification_preferences SET enabled=0 WHERE owner=? AND channel='email'").run(this.binding.owner);
    this.db.prepare("UPDATE notification_outbox SET state='revoked' WHERE owner=? AND channel='email' AND state='pending'").run(this.binding.owner);
  }
  activate(now=Date.now()){
    const d=day(now);
    atomic(this.db,()=>{
      if(this.db.prepare('SELECT singleton FROM notification_email_binding').get()) throw new Error('Email binding already initialized');
      this.db.prepare("INSERT INTO notification_email_binding VALUES (1,?,?,'active',?,0)").run(this.binding.owner,this.digest,d);
      this.clearConsent();
    });
  }
  state():'inactive'|'active'|'blocked'|'revoked'{
    const row=this.db.prepare('SELECT owner,digest,state FROM notification_email_binding WHERE singleton=1').get();
    return !row || row.owner!==this.binding.owner || row.digest!==this.digest?'inactive':row.state as 'active'|'blocked'|'revoked';
  }
  revoke(){
    atomic(this.db,()=>{
      if(this.state()==='inactive') throw new Error('Email binding mismatch');
      this.db.prepare("UPDATE notification_email_binding SET state='revoked' WHERE singleton=1").run();
      this.clearConsent();
    });
  }
  private eligible(now:number){
    const d=day(now);
    const row=this.db.prepare("SELECT utc_day,attempts FROM notification_email_binding WHERE singleton=1 AND digest=? AND state='active'").get(this.digest);
    if(!row)return false;
    const last=Number(row.utc_day), n=Number(row.attempts);
    return Number.isSafeInteger(last)&&last>=0&&Number.isSafeInteger(n)&&n>=0&&
      d>=last&&(d>last||n<this.binding.dailyCap);
  }
  private reserve(now:number){
    const d=day(now);
    return atomic(this.db,()=>{
      if(!this.eligible(now))return false;
      return this.db.prepare(`UPDATE notification_email_binding SET state='blocked',
        attempts=CASE WHEN utc_day=? THEN attempts+1 ELSE 1 END,utc_day=?
        WHERE singleton=1 AND digest=? AND state='active'`).run(d,d,this.digest).changes===1;
    });
  }
  async runOnce(now=Date.now):Promise<boolean>{
    if(this.busy||!this.eligible(now()))return false;
    this.busy=true;
    try{
      return await this.delivery.runOnce(this.binding.owner,'email',async d=>{
        if(!this.reserve(now()))return 'not-sent';
        // Durable reservation precedes the external side effect. No private project,
        // URL, raw payload, tracking links, cc/bcc, attachments or arbitrary text.
        const body=JSON.stringify({sender:{email:this.binding.sender},to:[{email:this.binding.recipient}],
          subject:'Forgia — notifica',textContent:'Forgia — '+d.event.summary+'. Dettagli nella inbox.'});
        try{
          const reply=await this.transport(this.binding.apiKey,body);
          if(reply.status===201&&typeof reply.body==='string'&&Buffer.byteLength(reply.body)<=MAX_BODY){
            const parsed=JSON.parse(reply.body);
            if(typeof parsed?.messageId==='string'&&/^<[^<>\s]{1,250}>$/.test(parsed.messageId)){
              // A 201 is provider acceptance, NOT confirmed mailbox delivery.
              this.db.prepare("UPDATE notification_email_binding SET state='active' WHERE singleton=1 AND digest=? AND state='blocked'").run(this.digest);
              return 'sent';
            }
          }
        }catch{/* redact all provider/transport errors */}
        // Any uncertain response (including quota/auth errors) leaves the channel
        // durably blocked. No automatic retry, plan upgrade or resume.
        return 'uncertain';
      },now);
    }finally{this.busy=false;}
  }
}
