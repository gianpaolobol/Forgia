import {createHash} from 'node:crypto';
import {request} from 'node:http';
import type {DatabaseSync} from 'node:sqlite';

export type HeartbeatOutcome = 'accepted' | 'denied' | 'unavailable';

// Node-side only. The caller supplies a private local database and a credential
// obtained out of band. No token persistence, discovery, enrollment or network bind.
export class RemoteHeartbeatAgent {
  private readonly db: DatabaseSync;
  private readonly port: number;
  private readonly token: string;
  private readonly fingerprint: string;
  private active: Promise<HeartbeatOutcome> | null = null;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private running = false;
  private epoch = 0;

  constructor(db: DatabaseSync, port: number, token: string) {
    if (!Number.isInteger(port) || port < 1 || port > 65535 || port === 8787 ||
        typeof token !== 'string' || !/^[a-f0-9]{64}$/.test(token)) throw Error('Invalid heartbeat configuration');
    this.db = db; this.port = port; this.token = token;
    this.fingerprint = createHash('sha256').update(token).digest('hex');
    db.exec(`CREATE TABLE IF NOT EXISTS rc_agent_sequence (
      digest TEXT PRIMARY KEY, seq INTEGER NOT NULL CHECK(seq >= 0)
    )`);
    db.prepare('INSERT INTO rc_agent_sequence(digest,seq) VALUES (?,0) ON CONFLICT(digest) DO NOTHING').run(this.fingerprint);
  }

  private reserve(): number {
    // Single atomic SQLite statement, committed before dispatch. A lost response
    // consumes the sequence, and a restart cannot reuse it.
    const row = this.db.prepare('UPDATE rc_agent_sequence SET seq=seq+1 WHERE digest=? AND seq<? RETURNING seq')
      .get(this.fingerprint,Number.MAX_SAFE_INTEGER);
    if (!row || typeof row.seq !== 'number' || !Number.isSafeInteger(row.seq) || row.seq <= 0)
      throw Error('Heartbeat sequence unavailable');
    return row.seq;
  }

  private send(sequence: number): Promise<HeartbeatOutcome> {
    const body = JSON.stringify({sequence});
    return new Promise(resolve => {
      let settled = false;
      let deadline: ReturnType<typeof setTimeout> | undefined;
      const finish = (result: HeartbeatOutcome) => {
        if (settled) return;
        settled = true; if (deadline) clearTimeout(deadline); resolve(result);
      };
      const req = request({
        hostname:'127.0.0.1', port:this.port, path:'/v1/heartbeat', method:'POST',
        agent:false, headers:{Authorization:'Bearer '+this.token,
          'Content-Type':'application/json','Content-Length':Buffer.byteLength(body),
          'Connection':'close'},
      }, res => {
        if (res.statusCode === 401 || res.statusCode === 403) {
          finish('denied'); res.destroy(); return;
        }
        if (res.statusCode !== 200 || res.headers['content-type'] !== 'application/json; charset=utf-8') {
          finish('unavailable'); res.destroy(); return;
        }
        let size = 0; const chunks: Buffer[] = [];
        res.on('data', (chunk: Buffer) => {
          size += chunk.length;
          if (size > 128) { finish('unavailable'); res.destroy(); return; }
          chunks.push(chunk);
        });
        res.on('aborted', () => finish('unavailable'));
        res.on('error', () => finish('unavailable'));
        res.on('end', () => {
          try {
            const value: unknown = JSON.parse(Buffer.concat(chunks).toString('utf8'));
            finish(value && typeof value === 'object' && !Array.isArray(value) &&
              Object.keys(value).length === 1 && 'accepted' in value && value.accepted === true
              ? 'accepted' : 'unavailable');
          } catch { finish('unavailable'); }
        });
      });
      deadline = setTimeout(() => { finish('unavailable'); req.destroy(); }, 5000);
      req.on('error', () => finish('unavailable'));
      req.end(body);
    });
  }

  pulse(): Promise<HeartbeatOutcome> {
    if (this.active) return this.active;
    const operation = Promise.resolve().then(() => this.send(this.reserve()))
      .catch((): HeartbeatOutcome => 'unavailable');
    this.active = operation;
    void operation.then(() => { if (this.active === operation) this.active = null; });
    return operation;
  }

  // One pulse at a time; no retry storm. Denial stops the loop until explicit
  // local reconfiguration. Transient failures use the same bounded interval.
  start(intervalMs = 30_000) {
    if (!Number.isSafeInteger(intervalMs) || intervalMs < 10_000 || intervalMs > 60_000)
      throw Error('Invalid heartbeat interval');
    if (this.running) return;
    this.running = true;
    const epoch = ++this.epoch;
    const tick = async () => {
      const outcome = await this.pulse();
      if (!this.running || epoch !== this.epoch) return;
      if (outcome === 'denied') { this.running = false; return; }
      this.timer = setTimeout(() => { this.timer = null; void tick(); }, intervalMs);
    };
    void tick();
  }

  async stop() {
    this.running = false; this.epoch++;
    if (this.timer) { clearTimeout(this.timer); this.timer = null; }
    await this.active;
  }
}
