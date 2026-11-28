import {DatabaseSync} from 'node:sqlite';

const providers = ['groq','openrouter','cloudflare'] as const;
type CloudProvider = typeof providers[number];
const maximum = 20;
const invalid = () => Error('Stato quota non valido: nessun invio.');
function providerId(value: string): CloudProvider {
  if (!providers.includes(value as CloudProvider)) throw invalid();
  return value as CloudProvider;
}
function dayOf(time: number) {
  if (!Number.isSafeInteger(time) || time < 0 || time > 253402300799999) throw invalid();
  return new Date(time).toISOString().slice(0,10);
}
function validDay(value: unknown): value is string {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const ms = Date.parse(value);
  return Number.isSafeInteger(ms) && ms >= 0 && ms <= 253402300799999 && dayOf(ms) === value;
}
function object(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw invalid();
  return value as Record<string, unknown>;
}

// Server-only, shared by every caller using the same private database.
// Call reserve only after consent and free-plan eligibility; each grant consumes
// one attempt even if the process dies before sending. Never refund/reuse a grant.
export function openQuotaLedger(path: string, clock: () => number = Date.now) {
  const db = new DatabaseSync(path);
  try {
    db.exec(`PRAGMA busy_timeout=5000; PRAGMA journal_mode=WAL; PRAGMA synchronous=FULL;
      CREATE TABLE IF NOT EXISTS forgia_quota_meta_v1 (
        singleton INTEGER PRIMARY KEY CHECK(singleton=1), last_ms INTEGER NOT NULL);
      CREATE TABLE IF NOT EXISTS forgia_quota_v1 (
        provider TEXT PRIMARY KEY, day TEXT NOT NULL,
        used INTEGER NOT NULL CHECK(used>=0), cooldown_until INTEGER NOT NULL CHECK(cooldown_until>=0));`);
  } catch (error) { db.close(); throw error; }
  const q = (sql: string) => db.prepare(sql);
  function tx<T>(work: () => T): T {
    db.exec('BEGIN IMMEDIATE');
    try { const result = work(); db.exec('COMMIT'); return result; }
    catch (error) { db.exec('ROLLBACK'); throw error; }
  }
  function tick() {
    const now = clock(), day = dayOf(now);
    const meta = q('SELECT last_ms FROM forgia_quota_meta_v1 WHERE singleton=1').get();
    if (!meta || !Number.isSafeInteger(meta.last_ms) || Number(meta.last_ms)<0 || now < Number(meta.last_ms)) throw invalid();
    q('UPDATE forgia_quota_meta_v1 SET last_ms=? WHERE singleton=1').run(now);
    return {now,day};
  }
  function current(provider: CloudProvider, day: string) {
    const row = q('SELECT day,used,cooldown_until FROM forgia_quota_v1 WHERE provider=?').get(provider);
    if (!row || !validDay(row.day) || row.day > day || !Number.isSafeInteger(row.used) || Number(row.used)<0 || !Number.isSafeInteger(row.cooldown_until) || Number(row.cooldown_until)<0) throw invalid();
    return {used:row.day===day?Number(row.used):0, cooldownUntil:Number(row.cooldown_until)};
  }
  function save(provider: CloudProvider, day: string, used: number, cooldownUntil: number) {
    q('UPDATE forgia_quota_v1 SET day=?,used=?,cooldown_until=? WHERE provider=?').run(day,used,cooldownUntil,provider);
  }
  return {
    // Offline bootstrap only, with all legacy writers stopped. null explicitly
    // means a genuinely new installation, NOT a missing or corrupt old file.
    initialize(snapshot: unknown) {
      return tx(() => {
        if (q('SELECT 1 FROM forgia_quota_meta_v1').get() || q('SELECT 1 FROM forgia_quota_v1').get()) throw invalid();
        const now = clock(), day = dayOf(now);
        let counts: Record<string,unknown> = {}, sourceDay = day;
        if (snapshot !== null) {
          const raw = object(snapshot);
          if (raw.version !== 1 || !validDay(raw.day) || raw.day > day) throw invalid();
          sourceDay = raw.day;
          counts = object(raw.counts);
          for (const [id,count] of Object.entries(counts)) {
            if (![...providers,'local','llamacpp'].includes(id) || !Number.isSafeInteger(count) || Number(count)<0) throw invalid();
          }
        }
        q('INSERT INTO forgia_quota_meta_v1(singleton,last_ms) VALUES(1,?)').run(now);
        for (const id of providers) {
          const used = sourceDay===day && Object.hasOwn(counts,id) ? Number(counts[id]) : 0;
          q('INSERT INTO forgia_quota_v1(provider,day,used,cooldown_until) VALUES(?,?,?,0)').run(id,day,used);
        }
      });
    },
    reserve(id: string, limit = maximum, reserve = 0) {
      const provider = providerId(id);
      if (!Number.isSafeInteger(limit) || limit<1 || limit>maximum || !Number.isSafeInteger(reserve) || reserve<0 || reserve>limit) throw invalid();
      return tx(() => {
        const {now,day} = tick(), state = current(provider,day);
        if (state.cooldownUntil > now) return {granted:false,reason:'cooldown' as const,used:state.used,nextEligibleAt:state.cooldownUntil};
        if (state.used >= limit-reserve) return {granted:false,reason:'quota' as const,used:state.used};
        const used = state.used+1;
        save(provider,day,used,state.cooldownUntil);
        return {granted:true,used};
      });
    },
    read(id: string) {
      const provider = providerId(id);
      return tx(() => {const {day} = tick(); return current(provider,day);});
    },
    // The caller supplies a validated absolute Retry-After deadline; never
    // shorten an earlier cooldown, even when the UTC day changes.
    cooldown(id: string, until: number) {
      const provider = providerId(id);
      dayOf(until);
      return tx(() => {
        const {now,day} = tick(), state = current(provider,day);
        if (until <= now) throw invalid();
        const next = Math.max(until,state.cooldownUntil);
        save(provider,day,state.used,next);
        return next;
      });
    },
    close() {db.close();}
  };
}
