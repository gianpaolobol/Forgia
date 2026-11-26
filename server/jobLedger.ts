import {DatabaseSync} from 'node:sqlite';
import {randomUUID} from 'node:crypto';
import {importLegacySnapshot} from './legacyJobMigration.ts';
import {findDurableReceipt} from './receiptLookup.ts';

type Lease = {id: string; fence: number; worker: string};
type Row = {id: string; session: string; payload: string; status: string; fence: number; worker: string | null; expires: number | null; result: string | null};

// Server-only primitive. Caller owns the private directory and migration policy.
export function openJobLedger(path: string) {
  const db = new DatabaseSync(path);
  db.exec(`PRAGMA busy_timeout=5000; PRAGMA journal_mode=WAL; PRAGMA synchronous=FULL;
    CREATE TABLE IF NOT EXISTS forgia_jobs_v1 (
      id TEXT PRIMARY KEY, session TEXT NOT NULL, request_key TEXT, payload TEXT NOT NULL,
      status TEXT NOT NULL CHECK(status IN ('queued','claimed','dispatched','done','failed','uncertain')),
      fence INTEGER NOT NULL DEFAULT 0, worker TEXT, expires INTEGER, result TEXT,
      UNIQUE(session, request_key)
    );
    CREATE TABLE IF NOT EXISTS forgia_job_deferral_v1 (
      id TEXT PRIMARY KEY REFERENCES forgia_jobs_v1(id),
      next_eligible_at INTEGER NOT NULL CHECK(next_eligible_at>=0),
      attempts INTEGER NOT NULL CHECK(attempts BETWEEN 1 AND 2)
    );
    CREATE TABLE IF NOT EXISTS forgia_local_cooldown_v1 (
      provider TEXT PRIMARY KEY CHECK(provider IN ('local','llamacpp')),
      until_ms INTEGER NOT NULL CHECK(until_ms>=0)
    );`);
  const q = (sql: string) => db.prepare(sql);
  function tx<T>(fn: () => T): T {
    db.exec('BEGIN IMMEDIATE');
    try { const value = fn(); db.exec('COMMIT'); return value; }
    catch (error) { db.exec('ROLLBACK'); throw error; }
  }
  function validateNow(now: number) {
    if (!Number.isSafeInteger(now) || now < 0) throw Error('Clock non valido.');
  }
  function validateLease(lease: Lease) {
    if (!lease || typeof lease.id !== 'string' || !lease.id || typeof lease.worker !== 'string' || !lease.worker || !Number.isSafeInteger(lease.fence) || lease.fence < 1) throw Error('Lease non valido.');
  }
  function expiry(now: number, ttl: number) {
    validateNow(now);
    if (!Number.isSafeInteger(ttl) || ttl < 1 || ttl > 300000 || !Number.isSafeInteger(now + ttl)) throw Error('Lease non valido.');
    return now + ttl;
  }
  function recover(now: number) {
    const uncertain = q("UPDATE forgia_jobs_v1 SET status='uncertain', worker=NULL, expires=NULL WHERE status='dispatched' AND expires<=?").run(now);
    const queued = q("UPDATE forgia_jobs_v1 SET status='queued', worker=NULL, expires=NULL WHERE status='claimed' AND expires<=?").run(now);
    return {uncertain: Number(uncertain.changes), queued: Number(queued.changes)};
  }
  function transition(lease: Lease, now: number, from: string, to: string, result: string | null) {
    validateNow(now);
    validateLease(lease);
    const terminal = to === 'done' || to === 'failed' || to === 'uncertain';
    return Number(q('UPDATE forgia_jobs_v1 SET status=?, result=?, worker=CASE WHEN ? THEN NULL ELSE worker END, expires=CASE WHEN ? THEN NULL ELSE expires END WHERE id=? AND fence=? AND worker=? AND expires>? AND status=?').run(to,result,Number(terminal),Number(terminal),lease.id,lease.fence,lease.worker,now,from).changes) === 1;
  }
  return {
    importLegacy(raw: string, requireExisting = false) { return importLegacySnapshot(db,raw,requireExisting); },
    enqueue(session: string, requestKey: string | null, payload: string) {
      if (!session || requestKey === '' || !payload) throw Error('Richiesta non valida.');
      return tx(() => {
        if (requestKey !== null) {
          const old = q('SELECT id,payload FROM forgia_jobs_v1 WHERE session=? AND request_key=?').get(session, requestKey);
          if (old) { if (old.payload !== payload) throw Object.assign(Error('Chiave già usata per altro payload.'), {status:409}); return String(old.id); }
        }
        const active = "status IN ('queued','claimed','dispatched')";
        const total = q('SELECT count(*) AS n FROM forgia_jobs_v1 WHERE '+active).get();
        const own = q('SELECT count(*) AS n FROM forgia_jobs_v1 WHERE '+active+' AND session=?').get(session);
        if (Number(total?.n) >= 16 || Number(own?.n) >= 3) throw Object.assign(Error('Coda piena.'), {status:429});
        const id = randomUUID();
        q("INSERT INTO forgia_jobs_v1(id,session,request_key,payload,status) VALUES(?,?,?,?,'queued')").run(id,session,requestKey,payload);
        return id;
      });
    },
    recoverExpired(now: number) {
      validateNow(now);
      return tx(() => recover(now));
    },
    claim(worker: string, now: number, ttl: number): Row | null {
      const until = expiry(now,ttl);
      if (typeof worker !== 'string' || !worker) throw Error('Worker non valido.');
      return tx(() => {
        recover(now);
        const row = q("SELECT j.id FROM forgia_jobs_v1 j LEFT JOIN forgia_job_deferral_v1 d ON d.id=j.id WHERE j.status='queued' AND (d.id IS NULL OR d.next_eligible_at<=?) ORDER BY j.rowid LIMIT 1").get(now);
        if (!row) return null;
        q("UPDATE forgia_jobs_v1 SET status='claimed', fence=fence+1, worker=?, expires=? WHERE id=?").run(worker,until,row.id);
        return q('SELECT * FROM forgia_jobs_v1 WHERE id=?').get(row.id) as unknown as Row;
      });
    },
    failClaim(lease: Lease, now: number, result: string) { return transition(lease,now,'claimed','failed',result); },
    markUncertain(lease: Lease, now: number) { return transition(lease,now,'dispatched','uncertain',null); },
    deferQuota(lease: Lease, now: number, nextEligibleAt: number): 'deferred' | 'exhausted' | 'lease-lost' {
      validateNow(now); validateLease(lease);
      if (!Number.isSafeInteger(nextEligibleAt) || nextEligibleAt <= now || nextEligibleAt > 253402300799999) throw Error('Deadline quota non valida.');
      return tx(() => {
        const active = q("SELECT 1 FROM forgia_jobs_v1 WHERE id=? AND fence=? AND worker=? AND expires>? AND status='dispatched'").get(lease.id,lease.fence,lease.worker,now);
        if (!active) return 'lease-lost';
        const previous = q('SELECT attempts FROM forgia_job_deferral_v1 WHERE id=?').get(lease.id);
        const attempts = Number(previous?.attempts ?? 0);
        if (attempts >= 2) {
          return transition(lease,now,'dispatched','failed',JSON.stringify({error:'Limite riprese automatiche raggiunto.',statusCode:429})) ? 'exhausted' : 'lease-lost';
        }
        q("UPDATE forgia_jobs_v1 SET status='queued',worker=NULL,expires=NULL,result=NULL WHERE id=?").run(lease.id);
        q('INSERT INTO forgia_job_deferral_v1(id,next_eligible_at,attempts) VALUES(?,?,?) ON CONFLICT(id) DO UPDATE SET next_eligible_at=excluded.next_eligible_at,attempts=excluded.attempts').run(lease.id,nextEligibleAt,attempts+1);
        return 'deferred';
      });
    },
    localCooldownUntil(provider: string): number {
      if (!['local','llamacpp'].includes(provider)) throw Error('Runtime locale non valido.');
      const row=q('SELECT until_ms FROM forgia_local_cooldown_v1 WHERE provider=?').get(provider);
      const until=Number(row?.until_ms??0);
      if (!Number.isSafeInteger(until) || until<0 || until>253402300799999) throw Error('Cooldown locale non valido.');
      return until;
    },
    recordLocalCooldown(provider: string, until: number) {
      if (!['local','llamacpp'].includes(provider) || !Number.isSafeInteger(until) || until<0 || until>253402300799999) throw Error('Cooldown locale non valido.');
      q('INSERT INTO forgia_local_cooldown_v1(provider,until_ms) VALUES(?,?) ON CONFLICT(provider) DO UPDATE SET until_ms=max(until_ms,excluded.until_ms)').run(provider,until);
    },
    deferredUntil(id: string): number | undefined {
      const row=q("SELECT d.next_eligible_at AS deadline FROM forgia_job_deferral_v1 d JOIN forgia_jobs_v1 j ON j.id=d.id WHERE j.id=? AND j.status='queued'").get(id);
      return row ? Number(row.deadline) : undefined;
    },
    markDispatched(lease: Lease, now: number) { return transition(lease,now,'claimed','dispatched',null); },
    heartbeat(lease: Lease, now: number, ttl: number) {
      const until = expiry(now,ttl);
      validateLease(lease);
      return Number(q("UPDATE forgia_jobs_v1 SET expires=max(expires,?) WHERE id=? AND fence=? AND worker=? AND expires>? AND status IN ('claimed','dispatched')").run(until,lease.id,lease.fence,lease.worker,now).changes) === 1;
    },
    finish(lease: Lease, now: number, status: 'done' | 'failed', result: string) {
      if (status !== 'done' && status !== 'failed') throw Error('Esito non valido.');
      return transition(lease,now,'dispatched',status,result);
    },
    queuedCount() { return Number(q("SELECT count(*) AS n FROM forgia_jobs_v1 WHERE status='queued'").get()?.n ?? 0); },
    // ONLY for the dedicated trusted loopback API, never for authenticated pilot requests.
    findReceipt(session:unknown,key:unknown) { return findDurableReceipt(db,session,key); },
    readLocal(id: string) { return (q('SELECT * FROM forgia_jobs_v1 WHERE id=?').get(id) ?? null) as unknown as Row | null; },
    read(id: string, session: string) { return (q('SELECT * FROM forgia_jobs_v1 WHERE id=? AND session=?').get(id,session) ?? null) as unknown as Row | null; },
    close() { db.close(); }
  };
}
