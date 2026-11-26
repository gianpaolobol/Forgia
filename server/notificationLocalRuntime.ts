import {closeSync,lstatSync,openSync,realpathSync} from 'node:fs';
import {isAbsolute,join,resolve} from 'node:path';
import {DatabaseSync} from 'node:sqlite';
import {NotificationHub,normalizeNotification} from './notificationHub.ts';
import {NotificationDigest} from './notificationDigest.ts';
import {NotificationDelivery} from './notificationDelivery.ts';

const tables=['notification_events','notification_preferences','notification_outbox',
  'notification_digest_schedule','notification_digest_seen','notification_digest_inbox',
  'notification_delivery','notification_delivery_policy','notification_delivery_pace'];
function privateFile(path:string,uid:number){
  const s=lstatSync(path);
  if(!s.isFile()||s.isSymbolicLink()||s.nlink!==1||s.uid!==uid||(s.mode&0o077)!==0)
    throw Error('Invalid private notification file');
}
function scope(owner:string,project:string){
  if(typeof owner!=='string'||!/^[a-zA-Z0-9_-]{1,96}$/.test(owner))throw Error('Invalid owner');
  // Reuse the exact project validator, including forbidden path components.
  normalizeNotification({version:1,id:'scope',source:'scope',project,type:'task.updated',
    severity:'info',timestamp:0,correlation_id:'scope'});
}
// Local trusted POSIX operator only. No network service or authentication claims.
// Windows deliberately fails closed until a verified ACL implementation exists.
export function openNotificationLocal(directory:string, initialize=false){
  const uid=process.getuid?.();
  if(uid===undefined||!isAbsolute(directory))throw Error('Private POSIX directory required');
  const dir=resolve(directory),s=lstatSync(dir);
  if(!s.isDirectory()||s.isSymbolicLink()||s.uid!==uid||(s.mode&0o077)!==0||realpathSync(dir)!==dir)
    throw Error('Invalid private notification directory');
  const file=join(dir,'notifications.sqlite');
  if(initialize)closeSync(openSync(file,'wx',0o600));
  privateFile(file,uid);
  for(const suffix of ['-journal','-wal','-shm']){
    try{privateFile(file+suffix,uid);}
    catch(e){if((e as NodeJS.ErrnoException).code!=='ENOENT')throw e;continue;}
    if(initialize||suffix!=='-journal')throw Error('Unexpected notification sidecar');
  }
  const db=new DatabaseSync(file);
  try{
    db.exec('PRAGMA busy_timeout=3000; PRAGMA foreign_keys=ON; PRAGMA synchronous=FULL;');
    if(db.prepare('PRAGMA journal_mode=DELETE').get()?.journal_mode!=='delete')throw Error('Invalid journal');
    if(initialize){
      db.exec('BEGIN IMMEDIATE');
      try{
        new NotificationHub(db);new NotificationDigest(db);new NotificationDelivery(db);
        db.exec('CREATE TABLE notification_local_schema (version INTEGER PRIMARY KEY CHECK(version=1)); INSERT INTO notification_local_schema VALUES(1); COMMIT');
      }catch(e){db.exec('ROLLBACK');throw e;}
    }else{
      if(db.prepare('SELECT version FROM notification_local_schema').get()?.version!==1)
        throw Error('Unknown notification schema');
      const known=db.prepare("SELECT name FROM sqlite_master WHERE type='table'").all().map(x=>String(x.name));
      if(tables.some(t=>!known.includes(t)))throw Error('Incomplete notification schema');
    }
    return db;
  }catch(e){db.close();throw e;}
}
export class NotificationLocalRuntime{
  private hub:NotificationHub;
  private digest:NotificationDigest;
  private db:DatabaseSync;
  private owner:string;
  private project:string;
  constructor(db:DatabaseSync,owner:string,project:string){
    scope(owner,project);this.db=db;this.owner=owner;this.project=project;this.hub=new NotificationHub(db);this.digest=new NotificationDigest(db);
  }
  publish(input:unknown,now=Date.now()){
    const event=normalizeNotification(input);
    if(event.project!==this.project)throw Error('Project mismatch');
    return this.hub.publish(this.owner,input,now);
  }
  markRead(source:string,id:string,now=Date.now()){
    const row=this.db.prepare('SELECT 1 FROM notification_events WHERE owner=? AND project=? AND source=? AND id=?')
      .get(this.owner,this.project,source,id);
    return !!row&&this.hub.markRead(this.owner,source,id,now);
  }
  schedule(minute:number|null,now=Date.now()){this.digest.setSchedule(this.owner,this.project,minute,now);}
  tick(now=Date.now()){return this.digest.tick(this.owner,this.project,now);}
  // Only disable external channels here. Enabling needs verified recipient,
  // account and vault gates, not an unauthenticated UI or local convenience toggle.
  revoke(channel:'email'|'telegram'|'push'){this.hub.setPreference(this.owner,this.project,channel,false);}
  snapshot(unread=false,limit=50){
    this.db.exec('BEGIN');
    try{
      const events=this.hub.inbox(this.owner,this.project,unread,limit);
      const counts=this.db.prepare('SELECT COUNT(*) AS total,COUNT(CASE WHEN read_at IS NULL THEN 1 END) AS unread FROM notification_events WHERE owner=? AND project=?')
        .get(this.owner,this.project);
      const schedule=this.db.prepare('SELECT minute,next_at FROM notification_digest_schedule WHERE owner=? AND project=?')
        .get(this.owner,this.project);
      const preferences=this.db.prepare('SELECT channel,enabled FROM notification_preferences WHERE owner=? AND project=?')
        .all(this.owner,this.project);
      const delivery=this.db.prepare(`SELECT o.channel,
        CASE WHEN o.state='revoked' AND (d.state IS NULL OR d.state IN ('leased','retry')) THEN 'revoked'
        ELSE COALESCE(d.state,o.state) END AS state,COUNT(*) AS count
        FROM notification_outbox o LEFT JOIN notification_delivery d USING(owner,source,id,channel)
        WHERE o.owner=? AND o.project=? GROUP BY o.channel,2 ORDER BY o.channel,2`).all(this.owner,this.project);
      const result={version:1,project:this.project,events,total:Number(counts?.total),unread:Number(counts?.unread),
        digests:this.digest.inbox(this.owner,this.project),
        schedule:{minute:schedule?.minute??null,nextAt:schedule?.next_at??null},
        channels:(['email','telegram','push'] as const).map(channel=>({channel,
          preferenceEnabled:preferences.some(p=>p.channel===channel&&p.enabled===1),
          transportActive:false})),delivery};
      this.db.exec('COMMIT');return result;
    }catch(e){this.db.exec('ROLLBACK');throw e;}
  }
}
