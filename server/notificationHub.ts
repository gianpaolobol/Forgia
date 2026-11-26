import { DatabaseSync } from 'node:sqlite';

const summaries = {
  'build.ready': 'Build disponibile', 'ci.failed': 'CI fallita',
  'security.alert': 'Verifica di sicurezza richiesta', 'report.ready': 'Report disponibile',
  'task.updated': 'Avanzamento verificato',
} as const;
type Kind = keyof typeof summaries;
type Channel = 'email' | 'telegram' | 'push';
const channels: Channel[] = ['email', 'telegram', 'push'];
const id = (value: unknown): value is string => typeof value === 'string' && /^[a-zA-Z0-9_-]{1,96}$/.test(value);
const repo = (value: unknown): value is string => typeof value === 'string' && /^[a-zA-Z0-9_-]{1,64}\/[a-zA-Z0-9_.-]{1,100}$/.test(value) && !value.split('/').some(p => p === '.' || p === '..');
const time = (value: unknown): value is number => typeof value === 'number' && Number.isSafeInteger(value) && value >= 0;
function checkOwner(owner: string) { if (!id(owner)) throw new Error('Invalid owner'); }

// Trusted local ingress only. Identity is supplied by the authenticated caller in a future adapter.
// Free text, arbitrary URLs, recipient addresses and credentials never enter this store.
export function normalizeNotification(input: unknown) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw new Error('Invalid event');
  const e = input as Record<string, unknown>;
  if (Object.keys(e).some(k => !['version','id','source','project','type','severity','timestamp','correlation_id','evidence_url'].includes(k)) ||
      e.version !== 1 || !id(e.id) || !id(e.source) || !repo(e.project) || !id(e.correlation_id) ||
      typeof e.type !== 'string' || !Object.hasOwn(summaries, e.type) || !['info','warning','critical'].includes(String(e.severity)) || typeof e.severity !== 'string' || !time(e.timestamp)) throw new Error('Invalid event');
  if (e.evidence_url !== undefined) {
    const prefix = 'https://github.com/' + e.project + '/';
    if (typeof e.evidence_url !== 'string' || !e.evidence_url.startsWith(prefix) || !/^(?:issues|pull|actions\/runs)\/[1-9][0-9]{0,19}$/.test(e.evidence_url.slice(prefix.length))) throw new Error('Invalid evidence URL');
  }
  return {version:1 as const, id:e.id, source:e.source, project:e.project, type:e.type as Kind, severity:e.severity,
    timestamp:e.timestamp, correlation_id:e.correlation_id, summary:summaries[e.type as Kind], evidence_url:e.evidence_url as string | undefined};
}

export class NotificationHub {
  private db: DatabaseSync;
  constructor(db: DatabaseSync) {
    this.db = db;
    db.exec(`CREATE TABLE IF NOT EXISTS notification_events (
      owner TEXT NOT NULL, source TEXT NOT NULL, id TEXT NOT NULL, project TEXT NOT NULL, payload TEXT NOT NULL,
      received INTEGER NOT NULL, read_at INTEGER, PRIMARY KEY(owner,source,id));
      CREATE INDEX IF NOT EXISTS notification_inbox ON notification_events(owner,project,received);
      CREATE TABLE IF NOT EXISTS notification_preferences (
      owner TEXT NOT NULL, project TEXT NOT NULL, channel TEXT NOT NULL, enabled INTEGER NOT NULL,
      PRIMARY KEY(owner,project,channel));
      CREATE TABLE IF NOT EXISTS notification_outbox (
      owner TEXT NOT NULL, source TEXT NOT NULL, id TEXT NOT NULL, project TEXT NOT NULL, channel TEXT NOT NULL,
      state TEXT NOT NULL CHECK(state IN ('pending','revoked')), PRIMARY KEY(owner,source,id,channel));`);
  }
  private atomic<T>(fn: () => T): T {
    this.db.exec('BEGIN IMMEDIATE');
    try { const value = fn(); this.db.exec('COMMIT'); return value; }
    catch (err) { this.db.exec('ROLLBACK'); throw err; }
  }
  publish(owner: string, input: unknown, now = Date.now()) {
    checkOwner(owner); if (!time(now)) throw new Error('Invalid clock');
    const e = normalizeNotification(input), payload = JSON.stringify(e);
    return this.atomic(() => {
      const old = this.db.prepare('SELECT payload FROM notification_events WHERE owner=? AND source=? AND id=?').get(owner,e.source,e.id);
      if (old) { if (old.payload !== payload) throw new Error('Event conflict'); return {duplicate:true}; }
      this.db.prepare('INSERT INTO notification_events VALUES (?,?,?,?,?,?,NULL)').run(owner,e.source,e.id,e.project,payload,now);
      this.db.prepare(`INSERT INTO notification_outbox SELECT ?,?,?,?,channel,'pending' FROM notification_preferences
        WHERE owner=? AND project=? AND enabled=1`).run(owner,e.source,e.id,e.project,owner,e.project);
      return {duplicate:false};
    });
  }
  inbox(owner: string, project: string | null = null, unread = false, limit = 50) {
    checkOwner(owner); if (project !== null && !repo(project) || !Number.isInteger(limit) || limit < 1 || limit > 100 || typeof unread !== 'boolean') throw new Error('Invalid filter');
    return this.db.prepare(`SELECT payload,read_at FROM notification_events WHERE owner=? AND (? IS NULL OR project=?)
      AND (?=0 OR read_at IS NULL) ORDER BY received DESC,source,id LIMIT ?`).all(owner,project,project,Number(unread),limit)
      .map(row => ({event:JSON.parse(String(row.payload)) as ReturnType<typeof normalizeNotification>, readAt:row.read_at as number|null}));
  }
  markRead(owner: string, source: string, eventId: string, now = Date.now()) {
    checkOwner(owner); if (!id(source) || !id(eventId) || !time(now)) throw new Error('Invalid event key');
    return this.db.prepare('UPDATE notification_events SET read_at=COALESCE(read_at,?) WHERE owner=? AND source=? AND id=?').run(now,owner,source,eventId).changes === 1;
  }
  setPreference(owner: string, project: string, channel: Channel, enabled: boolean) {
    checkOwner(owner); if (!repo(project) || !channels.includes(channel) || typeof enabled !== 'boolean') throw new Error('Invalid preference');
    this.atomic(() => {
      this.db.prepare(`INSERT INTO notification_preferences VALUES (?,?,?,?) ON CONFLICT(owner,project,channel)
        DO UPDATE SET enabled=excluded.enabled`).run(owner,project,channel,Number(enabled));
      if (!enabled) this.db.prepare(`UPDATE notification_outbox SET state='revoked' WHERE owner=? AND project=? AND channel=? AND state='pending'`).run(owner,project,channel);
    });
  }
  // Inspection only: no sending or claiming capability in this increment.
  outbox(owner: string) {
    checkOwner(owner);
    return this.db.prepare('SELECT source,id,project,channel,state FROM notification_outbox WHERE owner=? ORDER BY source,id,channel LIMIT 100').all(owner);
  }
}
