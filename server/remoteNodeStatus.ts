import {createHash, randomBytes, randomUUID} from 'node:crypto';
import type {DatabaseSync} from 'node:sqlite';

// Local control-plane primitive. No listener, transport, shell, or remote enrollment.
type Role = 'node' | 'operator';
type Grant = {id: string; node: string; role: Role; seq: number; expires: number};
const identifier = /^[a-z0-9][a-z0-9_-]{0,63}$/;
const tokenPattern = /^[a-f0-9]{64}$/;
const digest = (token: string) => createHash('sha256').update(token).digest('hex');
const denied = () => Error('Autorizzazione nodo non valida.');
const maxTtl = 24 * 60 * 60 * 1000;
const heartbeatWindow = 90_000;

export class RemoteNodeStatus {
  private readonly db: DatabaseSync;
  private readonly clock: () => number;
  constructor(db: DatabaseSync, clock = Date.now) {
    this.db = db;
    this.clock = clock;
    db.exec(`
      CREATE TABLE IF NOT EXISTS rc_nodes (
        id TEXT PRIMARY KEY, seen INTEGER
      );
      CREATE TABLE IF NOT EXISTS rc_grants (
        id TEXT PRIMARY KEY, node TEXT NOT NULL REFERENCES rc_nodes(id),
        role TEXT NOT NULL CHECK(role IN ('node','operator')),
        digest TEXT UNIQUE NOT NULL, created INTEGER NOT NULL, expires INTEGER NOT NULL,
        revoked INTEGER NOT NULL DEFAULT 0 CHECK(revoked IN (0,1)),
        seq INTEGER NOT NULL DEFAULT 0
      );
      CREATE TABLE IF NOT EXISTS rc_clock (
        singleton INTEGER PRIMARY KEY CHECK(singleton=1),
        watermark INTEGER NOT NULL CHECK(watermark>=0)
      );
      INSERT INTO rc_clock(singleton,watermark)
        SELECT 1, MAX(COALESCE((SELECT MAX(created) FROM rc_grants),0),
                      COALESCE((SELECT MAX(seen) FROM rc_nodes),0))
        WHERE NOT EXISTS (SELECT 1 FROM rc_clock WHERE singleton=1);
      CREATE INDEX IF NOT EXISTS rc_grants_scope ON rc_grants(node,role,revoked,expires);
      CREATE TABLE IF NOT EXISTS rc_snapshots (
        id TEXT PRIMARY KEY, node TEXT NOT NULL REFERENCES rc_nodes(id),
        owner TEXT NOT NULL REFERENCES rc_grants(id),
        worker TEXT NOT NULL REFERENCES rc_grants(id),
        idem TEXT NOT NULL, created INTEGER NOT NULL, expires INTEGER NOT NULL,
        completed INTEGER, sequence INTEGER,
        UNIQUE(owner,idem),
        CHECK((completed IS NULL AND sequence IS NULL) OR
              (completed IS NOT NULL AND sequence IS NOT NULL AND sequence>0))
      );
      CREATE INDEX IF NOT EXISTS rc_snapshots_worker ON rc_snapshots(worker,completed,created,id);
    `);
  }

  private now() {
    const value = this.clock();
    if (!Number.isSafeInteger(value) || value < 0 || value > Number.MAX_SAFE_INTEGER - maxTtl) throw denied();
    return value;
  }

  private tx<T>(fn: () => T): T {
    this.db.exec('BEGIN IMMEDIATE');
    try {
      const result = fn();
      this.db.exec('COMMIT');
      return result;
    } catch (error) {
      this.db.exec('ROLLBACK');
      throw error;
    }
  }

  // Observe time durably even when a request is denied (e.g. an expired token).
  // Roll back the operation, not the watermark. Revocation remains possible
  // under clock rollback because it can only remove authority.
  private timed<T>(fn: (now: number) => T): T {
    const result = this.tx(() => {
      const now = this.now();
      const row = this.db.prepare('SELECT watermark FROM rc_clock WHERE singleton=1').get();
      if (!row || typeof row.watermark !== 'number' ||
          !Number.isSafeInteger(row.watermark) || row.watermark < 0 ||
          now < row.watermark) throw denied();
      this.db.prepare('UPDATE rc_clock SET watermark=? WHERE singleton=1').run(now);
      this.db.exec('SAVEPOINT rc_operation');
      let value: T;
      try {
        value = fn(now);
      } catch (error) {
        this.db.exec('ROLLBACK TO rc_operation');
        this.db.exec('RELEASE rc_operation');
        return {ok:false as const,error};
      }
      this.db.exec('RELEASE rc_operation');
      return {ok:true as const,value};
    });
    if (!result.ok) throw result.error;
    return result.value;
  }

  // Trusted local administrator only; never expose this method through a remote route.
  register(node: string) {
    if (typeof node !== 'string' || !identifier.test(node)) throw denied();
    this.db.prepare('INSERT INTO rc_nodes(id) VALUES (?) ON CONFLICT(id) DO NOTHING').run(node);
  }

  // Return the raw credential once; caller must transfer it privately. No log or storage of token.
  issue(node: string, role: Role, ttlMs: number) {
    return this.issueInternal(node,role,ttlMs,grant=>grant);
  }

  // Trusted synchronous local handover only. A failed vault insert rolls back
  // the new grant and any previous node rotation before releasing the lock.
  // The external vault may contain an unusable orphan if the control commit
  // fails or the process crashes; never replay automatically in that case.
  issueToLocalVault(node: string, role: Role, ttlMs: number, deliver: (token:string)=>void) {
    return this.issueInternal(node,role,ttlMs,grant=>{
      deliver(grant.token);
      return {id:grant.id,expiresAt:grant.expiresAt};
    });
  }

  private issueInternal<T>(node: string, role: Role, ttlMs: number, handover:(grant:{id:string;token:string;expiresAt:number})=>T):T {
    if (typeof node !== 'string' || !identifier.test(node) ||
        (role !== 'node' && role !== 'operator') ||
        !Number.isSafeInteger(ttlMs) || ttlMs <= 0 || ttlMs > maxTtl) throw denied();
    return this.timed(now => {
      if (!this.db.prepare('SELECT id FROM rc_nodes WHERE id=?').get(node)) throw denied();
      const id = randomUUID(), token = randomBytes(32).toString('hex');
      if (role === 'node') {
        // A replacement heartbeat credential cannot inherit the previous online state.
        this.db.prepare("UPDATE rc_grants SET revoked=1 WHERE node=? AND role='node'").run(node);
        this.db.prepare('UPDATE rc_nodes SET seen=NULL WHERE id=?').run(node);
      }
      this.db.prepare('INSERT INTO rc_grants(id,node,role,digest,created,expires) VALUES (?,?,?,?,?,?)')
        .run(id,node,role,digest(token),now,now+ttlMs);
      return handover({id, token, expiresAt: now+ttlMs});
    });
  }

  revoke(id: string) {
    if (typeof id !== 'string' || !/^[a-f0-9-]{36}$/.test(id)) throw denied();
    return this.tx(() => {
      const grant = this.db.prepare('SELECT node,role,revoked FROM rc_grants WHERE id=?').get(id);
      if (!grant || grant.revoked !== 0) return false;
      this.db.prepare('UPDATE rc_grants SET revoked=1 WHERE id=?').run(id);
      if (grant.role === 'node') this.db.prepare('UPDATE rc_nodes SET seen=NULL WHERE id=?').run(grant.node as string);
      return true;
    });
  }

  // Local admin inventory only: no raw tokens, digests, or sequence counters.
  // Include all non-revoked grants (even expired) so emergency revocation is
  // possible. A rolled-back clock must not prevent listing grant IDs.
  inspectGrants(node:string) {
    if (typeof node!=='string' || !identifier.test(node)) throw denied();
    return this.tx(()=>{
      if (!this.db.prepare('SELECT id FROM rc_nodes WHERE id=?').get(node)) throw denied();
      const rows=this.db.prepare('SELECT id,role,created,expires FROM rc_grants WHERE node=? AND revoked=0 ORDER BY created,id').all(node);
      return rows.map(row=>({id:row.id,role:row.role,createdAt:row.created,expiresAt:row.expires}));
    });
  }

  private authorize(token: string, role: Role, now: number): Grant {
    if (typeof token !== 'string' || !tokenPattern.test(token)) throw denied();
    const row = this.db.prepare('SELECT id,node,role,seq,expires FROM rc_grants WHERE digest=? AND role=? AND revoked=0 AND created<=? AND expires>?')
      .get(digest(token), role, now, now);
    if (!row) throw denied();
    return row as unknown as Grant;
  }

  heartbeat(token: string, sequence: number) {
    if (!Number.isSafeInteger(sequence) || sequence <= 0) throw denied();
    return this.timed(now => {
      const grant = this.authorize(token,'node',now);
      const node = this.db.prepare('SELECT seen FROM rc_nodes WHERE id=?').get(grant.node);
      if (!node || sequence <= grant.seq || (typeof node.seen === 'number' && now < node.seen)) throw denied();
      this.db.prepare('UPDATE rc_grants SET seq=? WHERE id=?').run(sequence,grant.id);
      this.db.prepare('UPDATE rc_nodes SET seen=? WHERE id=?').run(now,grant.node);
      // The only supported work is a diagnostic receipt of an authenticated
      // heartbeat. No user payload, subprocess, network call or external effect.
      // Complete at most one job in the same transaction as its heartbeat.
      this.db.prepare(`UPDATE rc_snapshots SET completed=?,sequence=? WHERE id=(
        SELECT s.id FROM rc_snapshots s JOIN rc_grants o ON o.id=s.owner
        WHERE s.worker=? AND s.node=? AND s.completed IS NULL AND s.expires>?
          AND o.role='operator' AND o.node=s.node AND o.revoked=0 AND o.created<=? AND o.expires>?
        ORDER BY s.created,s.id LIMIT 1)`).run(now,sequence,grant.id,grant.node,now,now,now);
      return {accepted:true as const};
    });
  }

  // Local-only operator workflow. Keys are scoped to a single grant. Retain
  // receipts until that grant expires; never replay an old key on rotation.
  requestSnapshot(token:string,key:string):{id:string} {
    if(typeof key!=='string'||!/^[a-zA-Z0-9_-]{16,64}$/.test(key))throw denied();
    return this.timed(now=>{
      const grant=this.authorize(token,'operator',now);
      const prior=this.db.prepare('SELECT id FROM rc_snapshots WHERE owner=? AND idem=?').get(grant.id,key);
      if(prior)return {id:prior.id as string};
      const worker=this.db.prepare("SELECT id FROM rc_grants WHERE node=? AND role='node' AND revoked=0 AND created<=? AND expires>?").get(grant.node,now,now);
      if(!worker)throw denied();
      this.db.prepare('DELETE FROM rc_snapshots WHERE expires<=?').run(now);
      const ownerCount=this.db.prepare('SELECT COUNT(*) AS n FROM rc_snapshots WHERE owner=?').get(grant.id)?.n;
      const total=this.db.prepare('SELECT COUNT(*) AS n FROM rc_snapshots').get()?.n;
      if(typeof ownerCount!=='number'||typeof total!=='number'||ownerCount>=32||total>=256)throw denied();
      const id=randomUUID();
      this.db.prepare('INSERT INTO rc_snapshots(id,node,owner,worker,idem,created,expires) VALUES (?,?,?,?,?,?,?)')
        .run(id,grant.node,grant.id,worker.id as string,key,now,grant.expires);
      return {id};
    });
  }

  // Recovery never creates or replays a request.
  findSnapshot(token:string,key:string):{id:string|null} {
    if(typeof key!=='string'||!/^[a-zA-Z0-9_-]{16,64}$/.test(key))throw denied();
    return this.timed(now=>{
      const grant=this.authorize(token,'operator',now);
      const row=this.db.prepare('SELECT id FROM rc_snapshots WHERE owner=? AND node=? AND idem=? AND expires>?')
        .get(grant.id,grant.node,key,now);
      return {id:row?row.id as string:null};
    });
  }

  readSnapshot(token:string,id:string) {
    if(typeof id!=='string'||!/^[a-f0-9-]{36}$/.test(id))throw denied();
    return this.timed(now=>{
      const grant=this.authorize(token,'operator',now);
      const row=this.db.prepare('SELECT node,worker,created,completed,sequence FROM rc_snapshots WHERE id=? AND owner=? AND node=? AND expires>?')
        .get(id,grant.id,grant.node,now);
      if(!row)throw denied();
      const active=this.db.prepare("SELECT 1 FROM rc_grants WHERE id=? AND node=? AND role='node' AND revoked=0 AND created<=? AND expires>?")
        .get(row.worker as string,grant.node,now,now);
      const state=row.completed!==null?'done':active?'queued':'cancelled';
      return {id,node:grant.node,state,createdAt:row.created as number,
        completedAt:row.completed as number|null,sequence:row.sequence as number|null};
    });
  }

  status(token: string): {node: string; online: boolean; lastSeenAt: number | null} {
    return this.timed(now => {
      const grant = this.authorize(token,'operator',now);
      const row = this.db.prepare('SELECT seen FROM rc_nodes WHERE id=?').get(grant.node);
      if (!row) throw denied();
      const lastSeenAt = typeof row.seen === 'number' ? row.seen : null;
      const active = this.db.prepare("SELECT 1 FROM rc_grants WHERE node=? AND role='node' AND revoked=0 AND created<=? AND expires>?")
        .get(grant.node,now,now);
      return {node:grant.node,online:!!active && lastSeenAt !== null && now >= lastSeenAt && now-lastSeenAt < heartbeatWindow,lastSeenAt};
    });
  }
}
