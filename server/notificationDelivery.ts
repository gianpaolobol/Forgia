import { DatabaseSync } from 'node:sqlite';
import { randomUUID } from 'node:crypto';
import { normalizeNotification } from './notificationHub.ts';

type Channel = 'email' | 'telegram' | 'push';
type Claim = { owner: string; source: string; id: string; channel: Channel; fence: string };
type Outcome = 'sent' | 'not-sent' | 'uncertain';
type Delivery = { project: string; event: ReturnType<typeof normalizeNotification>; channel: Channel };
const validId = (v: string) => typeof v === 'string' && /^[a-zA-Z0-9_-]{1,96}$/.test(v);
const validChannel = (v: string) => ['email','telegram','push'].includes(v);
const MAX_ATTEMPTS = 3, LEASE_MS = 60_000;
type Policy = { quietStartUtcMinute: number | null; quietEndUtcMinute: number | null; minGapMs: number };
const DEFAULT_POLICY: Policy = {quietStartUtcMinute:null,quietEndUtcMinute:null,minGapMs:1000};
const utcMinute = (now: number) => Math.floor(now / 60_000) % 1440;
function isQuiet(p: Policy, now: number) {
  const a=p.quietStartUtcMinute, b=p.quietEndUtcMinute, m=utcMinute(now);
  return a!==null && b!==null && (a<b ? m>=a && m<b : m>=a || m<b);
}
function validPolicy(p: Policy) {
  const minute=(x: number|null) => x===null || Number.isInteger(x) && x>=0 && x<1440;
  return !!p && minute(p.quietStartUtcMinute) && minute(p.quietEndUtcMinute) &&
    ((p.quietStartUtcMinute===null && p.quietEndUtcMinute===null) ||
     (p.quietStartUtcMinute!==null && p.quietEndUtcMinute!==null && p.quietStartUtcMinute!==p.quietEndUtcMinute)) &&
    Number.isSafeInteger(p.minGapMs) && p.minGapMs>=1000 && p.minGapMs<=86_400_000;
}
function clock(now: number) {
  if (!Number.isSafeInteger(now) || now < 0 || now > Number.MAX_SAFE_INTEGER - 600_000) throw new Error('Invalid clock');
}
function scope(owner: string, channel: Channel) {
  if (!validId(owner) || !validChannel(channel)) throw new Error('Invalid scope');
}
const key = (c: Claim) => [c.owner,c.source,c.id,c.channel] as const;

// Separate additive schema: no destructive rewrite of the existing inbox/outbox.
// This local coordinator trusts its caller; not remote auth or proof of consent at destination.
export class NotificationDelivery {
  private db: DatabaseSync;
  constructor(db: DatabaseSync) {
    this.db = db;
    db.exec(`CREATE TABLE IF NOT EXISTS notification_delivery (
      owner TEXT NOT NULL, source TEXT NOT NULL, id TEXT NOT NULL, channel TEXT NOT NULL,
      state TEXT NOT NULL CHECK(state IN ('leased','sending','retry','sent','dead','uncertain','revoked')),
      fence TEXT NOT NULL, expires INTEGER NOT NULL, attempts INTEGER NOT NULL, eligible INTEGER NOT NULL,
      PRIMARY KEY(owner,source,id,channel));
      CREATE TABLE IF NOT EXISTS notification_delivery_policy (
      owner TEXT NOT NULL, channel TEXT NOT NULL, quiet_start INTEGER, quiet_end INTEGER,
      min_gap INTEGER NOT NULL, PRIMARY KEY(owner,channel));
      CREATE TABLE IF NOT EXISTS notification_delivery_pace (
      owner TEXT NOT NULL, channel TEXT NOT NULL, last_dispatch INTEGER NOT NULL,
      PRIMARY KEY(owner,channel));`);
  }
  private atomic<T>(fn: () => T): T {
    this.db.exec('BEGIN IMMEDIATE');
    try { const result=fn(); this.db.exec('COMMIT'); return result; }
    catch(e) { this.db.exec('ROLLBACK'); throw e; }
  }
  // UTC only: callers must not present this as local-time/DST scheduling.
  // Local trusted administration; not an authentication or recipient-binding API.
  setPolicy(owner: string, channel: Channel, policy: Policy) {
    scope(owner,channel);
    if (!validPolicy(policy)) throw new Error('Invalid delivery policy');
    this.atomic(() => {
      this.db.prepare(`INSERT INTO notification_delivery_policy VALUES (?,?,?,?,?)
        ON CONFLICT(owner,channel) DO UPDATE SET quiet_start=excluded.quiet_start,
        quiet_end=excluded.quiet_end,min_gap=excluded.min_gap`).run(owner,channel,
        policy.quietStartUtcMinute,policy.quietEndUtcMinute,policy.minGapMs);
    });
  }
  private policy(owner: string, channel: Channel): Policy {
    const row=this.db.prepare('SELECT quiet_start,quiet_end,min_gap FROM notification_delivery_policy WHERE owner=? AND channel=?').get(owner,channel);
    if (!row) return DEFAULT_POLICY;
    const p={quietStartUtcMinute:row.quiet_start as number|null,quietEndUtcMinute:row.quiet_end as number|null,minGapMs:row.min_gap as number};
    if (!validPolicy(p)) throw new Error('Invalid persisted delivery policy');
    return p;
  }
  private paced(owner: string, channel: Channel, p: Policy, now: number) {
    const row=this.db.prepare('SELECT last_dispatch FROM notification_delivery_pace WHERE owner=? AND channel=?').get(owner,channel);
    if (!row) return false;
    const last=Number(row.last_dispatch); clock(last);
    // Clock rollback never opens the throttle early. Avoid overflow in last + gap.
    return now<last || now-last<p.minGapMs;
  }
  claim(owner: string, channel: Channel, now = Date.now(), project?: string): Claim | null {
    scope(owner,channel); clock(now);
    if(project!==undefined) normalizeNotification({version:1,id:'scope',source:'scope',project,type:'task.updated',severity:'info',timestamp:0,correlation_id:'scope'});
    return this.atomic(() => {
      // After send intent, even an expired lease cannot be reclaimed for retry.
      this.db.prepare(`UPDATE notification_delivery SET state='uncertain' WHERE owner=? AND channel=? AND state='sending' AND expires<=? AND (? IS NULL OR EXISTS (SELECT 1 FROM notification_outbox o WHERE o.owner=notification_delivery.owner AND o.source=notification_delivery.source AND o.id=notification_delivery.id AND o.channel=notification_delivery.channel AND o.project=?))`).run(owner,channel,now,project??null,project??null);
      const p=this.policy(owner,channel);
      if (this.paced(owner,channel,p,now)) return null;
      const row=this.db.prepare(`SELECT o.source,o.id,COALESCE(d.attempts,0) AS attempts
        FROM notification_outbox o JOIN notification_events e USING(owner,source,id)
        JOIN notification_preferences p ON p.owner=o.owner AND p.project=o.project AND p.channel=o.channel AND p.enabled=1
        LEFT JOIN notification_delivery d USING(owner,source,id,channel)
        WHERE o.owner=? AND o.channel=? AND o.state='pending' AND (? IS NULL OR o.project=?) AND
          (?=0 OR json_extract(e.payload,'$.severity')='critical') AND
          (d.state IS NULL OR (d.state='leased' AND d.expires<=?) OR (d.state='retry' AND d.eligible<=?))
        ORDER BY e.received,o.source,o.id LIMIT 1`).get(owner,channel,project??null,project??null,Number(isQuiet(p,now)),now,now);
      if (!row) return null;
      const c: Claim={owner,channel,source:String(row.source),id:String(row.id),fence:randomUUID()};
      this.db.prepare(`INSERT INTO notification_delivery VALUES (?,?,?,?,'leased',?,?,?,0)
        ON CONFLICT(owner,source,id,channel) DO UPDATE SET state='leased',fence=excluded.fence,expires=excluded.expires`).run(...key(c),c.fence,now+LEASE_MS,Number(row.attempts));
      return c;
    });
  }
  begin(c: Claim, now = Date.now()): Delivery | null {
    scope(c.owner,c.channel); clock(now);
    return this.atomic(() => {
      const row=this.db.prepare(`SELECT o.project,e.payload,o.state AS consent,p.enabled,d.attempts
        FROM notification_delivery d JOIN notification_outbox o USING(owner,source,id,channel)
        JOIN notification_events e USING(owner,source,id)
        LEFT JOIN notification_preferences p ON p.owner=o.owner AND p.project=o.project AND p.channel=o.channel
        WHERE d.owner=? AND d.source=? AND d.id=? AND d.channel=? AND d.fence=? AND d.state='leased' AND d.expires>?`).get(...key(c),c.fence,now);
      if (!row) return null;
      if (row.consent !== 'pending' || row.enabled !== 1) {
        this.db.prepare(`UPDATE notification_delivery SET state='revoked' WHERE owner=? AND source=? AND id=? AND channel=? AND fence=?`).run(...key(c),c.fence);
        return null;
      }
      // Revalidate persisted payload; never forward arbitrary summary or extra fields.
      const stored=JSON.parse(String(row.payload)); const {summary: _summary,...input}=stored;
      const event=normalizeNotification(input);
      if (event.source!==c.source || event.id!==c.id || event.project!==row.project) throw new Error('Event mismatch');
      const p=this.policy(c.owner,c.channel);
      if (this.paced(c.owner,c.channel,p,now) || (isQuiet(p,now) && event.severity!=='critical')) {
        // Another worker or a changed policy may close the gate after claim.
        // Release the lease without consuming an attempt or invoking the adapter.
        this.db.prepare(`UPDATE notification_delivery SET state='retry',eligible=? WHERE owner=? AND source=? AND id=? AND channel=? AND fence=?`).run(now,...key(c),c.fence);
        return null;
      }
      // Reserve before the external side effect, in the same transaction as send intent.
      this.db.prepare(`INSERT INTO notification_delivery_pace VALUES (?,?,?)
        ON CONFLICT(owner,channel) DO UPDATE SET last_dispatch=excluded.last_dispatch`).run(c.owner,c.channel,now);
      this.db.prepare(`UPDATE notification_delivery SET state='sending',attempts=attempts+1,expires=? WHERE owner=? AND source=? AND id=? AND channel=? AND fence=?`).run(now+LEASE_MS,...key(c),c.fence);
      return {project:event.project,event,channel:c.channel};
    });
  }
  finish(c: Claim, outcome: Outcome, now = Date.now()): boolean {
    scope(c.owner,c.channel); clock(now);
    if (!['sent','not-sent','uncertain'].includes(outcome)) throw new Error('Invalid outcome');
    return this.atomic(() => {
      const row=this.db.prepare(`SELECT d.attempts,d.expires,o.state AS consent FROM notification_delivery d
        JOIN notification_outbox o USING(owner,source,id,channel) WHERE d.owner=? AND d.source=? AND d.id=? AND d.channel=? AND d.fence=? AND d.state='sending'`).get(...key(c),c.fence);
      if (!row) return false;
      const attempts=Number(row.attempts);
      const state=Number(row.expires)<=now || outcome==='uncertain' ? 'uncertain' : outcome==='sent' ? 'sent' : row.consent!=='pending' ? 'revoked' : attempts>=MAX_ATTEMPTS ? 'dead' : 'retry';
      this.db.prepare(`UPDATE notification_delivery SET state=?,eligible=? WHERE owner=? AND source=? AND id=? AND channel=? AND fence=?`).run(state,state==='retry'?now+30_000*2**(attempts-1):0,...key(c),c.fence);
      return true;
    });
  }
  // Adapter must classify not-sent ONLY when non-delivery is proven. Timeout/exception => uncertain.
  // Invoke only with a separately authorized, free adapter and verified recipient binding.
  async runOnce(owner: string, channel: Channel, send: (delivery: Delivery) => Promise<Outcome>, now = Date.now, project?: string): Promise<boolean> {
    const c=this.claim(owner,channel,now(),project); if (!c) return false;
    const delivery=this.begin(c,now()); if (!delivery) return false;
    let outcome: Outcome='uncertain';
    try { const result=await send(delivery); if (['sent','not-sent','uncertain'].includes(result)) outcome=result; } catch { /* no unsafe retry */ }
    return this.finish(c,outcome,now());
  }
  status(owner: string) {
    if (!validId(owner)) throw new Error('Invalid owner');
    return this.db.prepare(`SELECT o.source,o.id,o.project,o.channel,
      CASE WHEN o.state='revoked' AND (d.state IS NULL OR d.state IN ('leased','retry')) THEN 'revoked'
      ELSE COALESCE(d.state,o.state) END AS state,COALESCE(d.attempts,0) AS attempts
      FROM notification_outbox o LEFT JOIN notification_delivery d USING(owner,source,id,channel)
      WHERE o.owner=? ORDER BY o.source,o.id,o.channel LIMIT 100`).all(owner);
  }
}
