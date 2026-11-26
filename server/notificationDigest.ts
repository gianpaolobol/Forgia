import { DatabaseSync } from 'node:sqlite';

const DAY = 86_400_000, LIMIT = 500;
function validate(owner: string, project: string, now: number) {
  if (typeof owner !== 'string' || !/^[a-zA-Z0-9_-]{1,96}$/.test(owner) ||
      typeof project !== 'string' || !/^[a-zA-Z0-9_-]{1,64}\/[a-zA-Z0-9_.-]{1,100}$/.test(project) ||
      project.split('/').some(p => p === '.' || p === '..') ||
      !Number.isSafeInteger(now) || now < 0 || now > Number.MAX_SAFE_INTEGER - 2 * DAY) throw new Error('Invalid digest scope or clock');
}
function nextSlot(now: number, minute: number) {
  const today = Math.floor(now / DAY) * DAY + minute * 60_000;
  return today > now ? today : today + DAY;
}
type Digest = { slot: number; generatedAt: number; total: number; critical: number; warning: number; info: number; more: boolean };

// Local, trusted caller only. No external send, recipient or authentication surface.
// NotificationHub must initialize its event table first; use the same private SQLite DB.
export class NotificationDigest {
  private db: DatabaseSync;
  constructor(db: DatabaseSync) {
    this.db = db;
    db.exec(`CREATE TABLE IF NOT EXISTS notification_digest_schedule (
      owner TEXT NOT NULL, project TEXT NOT NULL, minute INTEGER, next_at INTEGER, observed INTEGER NOT NULL,
      PRIMARY KEY(owner,project));
      CREATE TABLE IF NOT EXISTS notification_digest_seen (
      owner TEXT NOT NULL, project TEXT NOT NULL, source TEXT NOT NULL, id TEXT NOT NULL,
      PRIMARY KEY(owner,project,source,id));
      CREATE TABLE IF NOT EXISTS notification_digest_inbox (
      owner TEXT NOT NULL, project TEXT NOT NULL, slot INTEGER NOT NULL, generated INTEGER NOT NULL,
      total INTEGER NOT NULL, critical INTEGER NOT NULL, warning INTEGER NOT NULL, info INTEGER NOT NULL,
      more INTEGER NOT NULL, PRIMARY KEY(owner,project,slot));`);
  }
  private atomic<T>(fn: () => T): T {
    this.db.exec('BEGIN IMMEDIATE');
    try { const value = fn(); this.db.exec('COMMIT'); return value; }
    catch (e) { this.db.exec('ROLLBACK'); throw e; }
  }
  // null disables future digest creation. Re-enabling excludes everything already in the inbox.
  setSchedule(owner: string, project: string, minute: number | null, now = Date.now()) {
    validate(owner,project,now);
    if (minute !== null && (!Number.isInteger(minute) || minute < 0 || minute >= 1440)) throw new Error('Invalid UTC minute');
    this.atomic(() => {
      const old = this.db.prepare('SELECT minute,next_at,observed FROM notification_digest_schedule WHERE owner=? AND project=?').get(owner,project);
      if (old && Number(old.observed) > now) throw new Error('Digest clock rollback');
      if (old && old.minute === minute) {
        this.db.prepare('UPDATE notification_digest_schedule SET observed=? WHERE owner=? AND project=?').run(now,owner,project);
        return;
      }
      if (minute !== null && (!old || old.minute === null)) {
        this.db.prepare(`INSERT OR IGNORE INTO notification_digest_seen
          SELECT owner,project,source,id FROM notification_events WHERE owner=? AND project=?`).run(owner,project);
      }
      this.db.prepare(`INSERT INTO notification_digest_schedule VALUES (?,?,?,?,?)
        ON CONFLICT(owner,project) DO UPDATE SET minute=excluded.minute,next_at=excluded.next_at,observed=excluded.observed`)
        .run(owner,project,minute,minute === null ? null : nextSlot(now,minute),now);
    });
  }
  // At most one durable batch per due slot. Missed slots coalesce; overflow waits for the next slot.
  tick(owner: string, project: string, now = Date.now()): Digest | null {
    validate(owner,project,now);
    return this.atomic(() => {
      const s = this.db.prepare('SELECT minute,next_at,observed FROM notification_digest_schedule WHERE owner=? AND project=?').get(owner,project);
      if (!s || s.minute === null || now < Number(s.observed)) return null;
      this.db.prepare('UPDATE notification_digest_schedule SET observed=? WHERE owner=? AND project=?').run(now,owner,project);
      if (now < Number(s.next_at)) return null;
      const rows = this.db.prepare(`SELECT e.source,e.id,json_extract(e.payload,'$.severity') AS severity
        FROM notification_events e WHERE e.owner=? AND e.project=? AND e.received<=?
        AND NOT EXISTS (SELECT 1 FROM notification_digest_seen d
          WHERE d.owner=e.owner AND d.project=e.project AND d.source=e.source AND d.id=e.id)
        ORDER BY e.received,e.source,e.id LIMIT ?`).all(owner,project,now,LIMIT+1);
      const digest: Digest = {slot:Number(s.next_at),generatedAt:now,total:0,critical:0,warning:0,info:0,more:rows.length>LIMIT};
      const seen = this.db.prepare('INSERT INTO notification_digest_seen VALUES (?,?,?,?)');
      for (const row of rows.slice(0,LIMIT)) {
        const severity = row.severity;
        if (severity !== 'critical' && severity !== 'warning' && severity !== 'info') throw new Error('Invalid persisted severity');
        digest[severity]++; digest.total++;
        seen.run(owner,project,String(row.source),String(row.id));
      }
      this.db.prepare('UPDATE notification_digest_schedule SET next_at=? WHERE owner=? AND project=?')
        .run(nextSlot(now,Number(s.minute)),owner,project);
      if (!digest.total) return null;
      this.db.prepare('INSERT INTO notification_digest_inbox VALUES (?,?,?,?,?,?,?,?,?)')
        .run(owner,project,digest.slot,now,digest.total,digest.critical,digest.warning,digest.info,Number(digest.more));
      return digest;
    });
  }
  inbox(owner: string, project: string, limit = 30): Digest[] {
    validate(owner,project,0);
    if (!Number.isInteger(limit) || limit < 1 || limit > 100) throw new Error('Invalid digest limit');
    return this.db.prepare(`SELECT slot,generated,total,critical,warning,info,more FROM notification_digest_inbox
      WHERE owner=? AND project=? ORDER BY slot DESC LIMIT ?`).all(owner,project,limit)
      .map(r => ({slot:Number(r.slot),generatedAt:Number(r.generated),total:Number(r.total),critical:Number(r.critical),
        warning:Number(r.warning),info:Number(r.info),more:r.more===1}));
  }
}
