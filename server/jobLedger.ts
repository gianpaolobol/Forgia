import {DatabaseSync} from 'node:sqlite';
import {randomUUID} from 'node:crypto';
import {importLegacySnapshot} from './legacyJobMigration.ts';

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
        const row = q("SELECT id FROM forgia_jobs_v1 WHERE status='queued' ORDER BY rowid LIMIT 1").get();
        if (!row) return null;
        q("UPDATE forgia_jobs_v1 SET status='claimed', fence=fence+1, worker=?, expires=? WHERE id=?").run(worker,until,row.id);
        return q('SELECT * FROM forgia_jobs_v1 WHERE id=?').get(row.id) as unknown as Row;
      });
    },
    failClaim(lease: Lease, now: number, result: string) { return transition(lease,now,'claimed','failed',result); },
    markUncertain(lease: Lease, now: number) { return transition(lease,now,'dispatched','uncertain',null); },
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
    readLocal(id: string) { return (q('SELECT * FROM forgia_jobs_v1 WHERE id=?').get(id) ?? null) as unknown as Row | null; },
    read(id: string, session: string) { return (q('SELECT * FROM forgia_jobs_v1 WHERE id=? AND session=?').get(id,session) ?? null) as unknown as Row | null; },
    close() { db.close(); }
  };
}
