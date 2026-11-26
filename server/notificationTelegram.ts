import { DatabaseSync } from 'node:sqlite';
import { createHash } from 'node:crypto';
import { request } from 'node:https';
import { NotificationDelivery } from './notificationDelivery.ts';
import { NotificationHub } from './notificationHub.ts';

type Binding = { owner: string; chatId: number; token: string; consentVerified: true };
type Reply = { status: number; body: string };
type Transport = (path: string, body: string) => Promise<Reply>;
const MAX_BODY = 64 * 1024;
function fingerprint(b: Binding) {
  if (!b || typeof b.owner !== 'string' || !/^[a-zA-Z0-9_-]{1,96}$/.test(b.owner) ||
      !Number.isSafeInteger(b.chatId) || b.chatId <= 0 ||
      typeof b.token !== 'string' || !/^[0-9]{1,20}:[a-zA-Z0-9_-]{20,100}$/.test(b.token) ||
      b.consentVerified !== true) throw new Error('Invalid Telegram binding');
  return createHash('sha256').update(JSON.stringify([b.owner,b.chatId,b.token])).digest('hex');
}
function atomic<T>(db: DatabaseSync, fn: () => T): T {
  db.exec('BEGIN IMMEDIATE');
  try { const v=fn(); db.exec('COMMIT'); return v; }
  catch(e) { db.exec('ROLLBACK'); throw e; }
}
// Fixed HTTPS endpoint, no redirects, no retries, no raw provider errors.
// An absolute deadline covers both connect and response; response size is bounded.
function sendTelegram(path: string, body: string): Promise<Reply> {
  return new Promise((resolve,reject) => {
    const req=request({hostname:'api.telegram.org',port:443,method:'POST',path,
      headers:{'Content-Type':'application/json','Content-Length':Buffer.byteLength(body)}},res=>{
      const chunks:Buffer[]=[]; let bytes=0;
      res.on('data',(chunk:Buffer)=>{
        bytes+=chunk.length;
        if(bytes>MAX_BODY){res.destroy();req.destroy();reject(new Error('Telegram response limit'));return;}
        chunks.push(chunk);
      });
      res.on('error',()=>reject(new Error('Telegram response error')));
      res.on('aborted',()=>reject(new Error('Telegram response aborted')));
      res.on('end',()=>resolve({status:res.statusCode??0,body:Buffer.concat(chunks).toString('utf8')}));
    });
    const deadline=setTimeout(()=>{req.destroy();reject(new Error('Telegram timeout'));},10_000);
    req.on('error',()=>reject(new Error('Telegram transport error')));
    req.on('close',()=>clearTimeout(deadline));
    req.end(body);
  });
}
// Single dedicated bot/recipient/owner per database. Trusted local administration
// ONLY: consentVerified is an operator attestation, not authentication or proof of pairing.
// Never instantiate with real credentials before pairing/vault and independent review.
export class NotificationTelegram {
  private db: DatabaseSync;
  private delivery: NotificationDelivery;
  private binding: Binding;
  private digest: string;
  private transport: Transport;
  private busy=false;
  constructor(db: DatabaseSync, binding: Binding, transport: Transport = sendTelegram) {
    this.digest=fingerprint(binding);
    this.binding={...binding}; this.db=db; this.transport=transport;
    new NotificationHub(db);
    this.delivery=new NotificationDelivery(db);
    db.exec(`CREATE TABLE IF NOT EXISTS notification_telegram_binding (
      singleton INTEGER PRIMARY KEY CHECK(singleton=1), owner TEXT NOT NULL,
      digest TEXT NOT NULL, state TEXT NOT NULL CHECK(state IN ('active','paused','revoked')))`);
  }
  // Explicit first opt-in. Clear any pre-binding preferences/backlog; require
  // fresh per-project opt-in via NotificationHub after this operation.
  activate() {
    atomic(this.db,()=>{
      if(this.db.prepare('SELECT singleton FROM notification_telegram_binding').get()) throw new Error('Telegram binding already initialized');
      this.db.prepare("INSERT INTO notification_telegram_binding VALUES (1,?,?,'active')").run(this.binding.owner,this.digest);
      this.clearConsent();
    });
  }
  private clearConsent() {
    this.db.prepare("UPDATE notification_preferences SET enabled=0 WHERE owner=? AND channel='telegram'").run(this.binding.owner);
    this.db.prepare("UPDATE notification_outbox SET state='revoked' WHERE owner=? AND channel='telegram' AND state='pending'").run(this.binding.owner);
  }
  state(): 'inactive'|'active'|'paused'|'revoked' {
    const row=this.db.prepare('SELECT owner,digest,state FROM notification_telegram_binding WHERE singleton=1').get();
    if(!row || row.owner!==this.binding.owner || row.digest!==this.digest) return 'inactive';
    return row.state as 'active'|'paused'|'revoked';
  }
  revoke() {
    atomic(this.db,()=>{
      if(this.state()==='inactive') throw new Error('Telegram binding mismatch');
      this.db.prepare("UPDATE notification_telegram_binding SET state='revoked' WHERE singleton=1").run();
      this.clearConsent();
    });
  }
  private pause() {
    this.db.prepare("UPDATE notification_telegram_binding SET state='paused' WHERE singleton=1 AND digest=? AND state='active'").run(this.digest);
  }
  // No automatic resume after rate-limit or ambiguous delivery. Only an explicit
  // operator action after checking provider status/limits; never replay uncertain rows.
  resume() {
    atomic(this.db,()=>{
      if(this.state()!=='paused') throw new Error('Telegram binding not paused');
      this.db.prepare("UPDATE notification_telegram_binding SET state='active' WHERE singleton=1").run();
    });
  }
  async runOnce(now=Date.now): Promise<boolean> {
    if(this.busy || this.state()!=='active') return false;
    this.busy=true;
    try {
      return await this.delivery.runOnce(this.binding.owner,'telegram',async d=>{
        if(this.state()!=='active') return 'not-sent';
        const pending=this.db.prepare("SELECT COUNT(*) AS n FROM notification_delivery WHERE owner=? AND channel='telegram' AND state='sending'").get(this.binding.owner);
        if(Number(pending?.n)!==1) return 'not-sent';
        // Only the redacted fixed summary; no project, evidence link, free text,
        // account information or tokens in the message. Details stay in inbox.
        const body=JSON.stringify({chat_id:this.binding.chatId,
          text:'Forgia — '+d.event.summary+'. Dettagli nella inbox.',
          protect_content:true,allow_paid_broadcast:false});
        try {
          const reply=await this.transport('/bot'+this.binding.token+'/sendMessage',body);
          if(reply.status===200 && typeof reply.body==='string' && Buffer.byteLength(reply.body)<=MAX_BODY) {
            const parsed=JSON.parse(reply.body);
            if(parsed?.ok===true && Number.isSafeInteger(parsed.result?.message_id) &&
               parsed.result.message_id>0 && parsed.result?.chat?.id===this.binding.chatId &&
               parsed.result?.chat?.type==='private') return 'sent';
          }
        } catch { /* redact all provider/transport errors */ }
        // Includes 429: stop the channel persistently rather than retry before
        // Retry-After. Ambiguous outcomes are never replayed by the delivery worker.
        this.pause();
        return 'uncertain';
      },now);
    } finally { this.busy=false; }
  }
}
