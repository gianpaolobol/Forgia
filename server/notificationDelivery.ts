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
      PRIMARY KEY(owner,source,id,channel));`);
  }
  private atomic<T>(fn: () => T): T {
    this.db.exec('BEGIN IMMEDIATE');
    try { const result=fn(); this.db.exec('COMMIT'); return result; }
    catch(e) { this.db.exec('ROLLBACK'); throw e; }
  }
  claim(owner: string, channel: Channel, now = Date.now()): Claim | null {
    scope(owner,channel); clock(now);
    return this.atomic(() => {
      // After send intent, even an expired lease cannot be reclaimed for retry.
      this.db.prepare(`UPDATE notification_delivery SET state='uncertain' WHERE owner=? AND channel=? AND state='sending' AND expires<=?`).run(owner,channel,now);
      const row=this.db.prepare(`SELECT o.source,o.id,COALESCE(d.attempts,0) AS attempts
        FROM notification_outbox o JOIN notification_events e USING(owner,source,id)
        JOIN notification_preferences p ON p.owner=o.owner AND p.project=o.project AND p.channel=o.channel AND p.enabled=1
        LEFT JOIN notification_delivery d USING(owner,source,id,channel)
        WHERE o.owner=? AND o.channel=? AND o.state='pending' AND
          (d.state IS NULL OR (d.state='leased' AND d.expires<=?) OR (d.state='retry' AND d.eligible<=?))
        ORDER BY e.received,o.source,o.id LIMIT 1`).get(owner,channel,now,now);
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
  async runOnce(owner: string, channel: Channel, send: (delivery: Delivery) => Promise<Outcome>, now = Date.now): Promise<boolean> {
    const c=this.claim(owner,channel,now()); if (!c) return false;
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
