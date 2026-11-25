import type {DatabaseSync} from 'node:sqlite';
import {createHash} from 'node:crypto';

// Frozen jobs.v1 format. Offline only: all legacy writers must be stopped.
// The caller retains the original snapshot and controls cutover/rollback.
const invalid = () => Error('Snapshot jobs.v1 non valido o ambiguo.');
const sessionPattern = /^[a-f0-9-]{36}$/i;
const idPattern = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/;
const legacyProviders = new Set(['auto','local','llamacpp','groq','openrouter','cloudflare']);
function record(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw invalid();
  return value as Record<string, unknown>;
}
function fields(value: Record<string, unknown>, allowed: string[]) {
  if (Object.keys(value).some(key => !allowed.includes(key))) throw invalid();
}
export function inputPayload(value: unknown): string {
  const input = record(value);
  fields(input,['idea','provider','consent','context']);
  const {idea,provider,consent} = input;
  if (typeof idea !== 'string' || !idea || idea !== idea.trim() || idea.length > 8000 || /[\u0000-\u0008\u000b\u000c\u000e-\u001f]/u.test(idea) ||
      typeof provider !== 'string' || !legacyProviders.has(provider) || typeof consent !== 'boolean') throw invalid();
  const context = record(input.context);
  fields(context,['kind','phase']);
  if (!['catalog','tracker','community'].includes(context.kind as string) || !['draft','revision'].includes(context.phase as string)) throw invalid();
  return JSON.stringify({idea,provider,consent,context:{kind:context.kind,phase:context.phase}});
}

export function importLegacySnapshot(db: DatabaseSync, raw: string) {
  if (typeof raw !== 'string' || Buffer.byteLength(raw) > 64 * 1024 * 1024) throw invalid();
  const digest = createHash('sha256').update(raw).digest('hex');
  db.exec('BEGIN IMMEDIATE');
  try {
    db.exec('CREATE TABLE IF NOT EXISTS forgia_job_import_v1 (singleton INTEGER PRIMARY KEY CHECK(singleton=1), digest TEXT NOT NULL, count INTEGER NOT NULL)');
    const marker = db.prepare('SELECT digest,count FROM forgia_job_import_v1 WHERE singleton=1').get();
    if (marker) {
      if (marker.digest !== digest) throw Error('Snapshot già migrato con digest diverso.');
      db.exec('COMMIT');
      return {imported: Number(marker.count), alreadyImported:true, digest};
    }
    if (db.prepare('SELECT 1 FROM forgia_jobs_v1 LIMIT 1').get()) throw Error('Destinazione non vuota.');
    const snapshot: unknown = JSON.parse(raw);
    if (!Array.isArray(snapshot) || snapshot.length > 48) throw invalid();
    const insert = db.prepare('INSERT INTO forgia_jobs_v1(id,session,request_key,payload,status,result) VALUES(?,?,?,?,?,?)');
    const activeBySession = new Map<string,number>();
    let active = 0, terminal = 0;
    for (const value of snapshot) {
      const job = record(value);
      const {id,session,requestKey,status} = job;
      if (typeof id !== 'string' || !idPattern.test(id) || typeof session !== 'string' || !sessionPattern.test(session) ||
          (requestKey !== undefined && (typeof requestKey !== 'string' || !requestKey || requestKey.length > 1000))) throw invalid();
      // Empty payload is deliberately unmatchable: enqueue rejects empty payloads.
      let payload = '', result: string | null = null, target: string;
      const base = ['id','session','requestKey','status'];
      if (status === 'queued' || status === 'running') {
        fields(job,[...base,'input']);
        payload = inputPayload(job.input);
        active++;
        const own = (activeBySession.get(session) ?? 0) + 1;
        activeBySession.set(session,own);
        if (active > 16 || own > 3) throw invalid();
        target = status === 'running' ? 'uncertain' : 'queued';
      } else if (status === 'done') {
        fields(job,[...base,'result']);
        if (!Object.hasOwn(job,'result')) throw invalid();
        result = JSON.stringify(job.result);
        target = 'done';
        if (++terminal > 32) throw invalid();
      } else if (status === 'failed') {
        fields(job,[...base,'error','statusCode']);
        if (typeof job.error !== 'string' || !job.error || (job.statusCode !== undefined &&
            (typeof job.statusCode !== 'number' || !Number.isInteger(job.statusCode) || job.statusCode < 400 || job.statusCode > 599))) throw invalid();
        result = JSON.stringify({error:job.error,statusCode:job.statusCode});
        target = 'failed';
        if (++terminal > 32) throw invalid();
      } else throw invalid();
      // Duplicate ID/key (including old failed retries) is rejected by constraints;
      // never silently drop history or choose which old request to replay.
      insert.run(id,session,requestKey ?? null,payload,target,result);
    }
    db.prepare('INSERT INTO forgia_job_import_v1(singleton,digest,count) VALUES(1,?,?)').run(digest,snapshot.length);
    db.exec('COMMIT');
    return {imported:snapshot.length,alreadyImported:false,digest};
  } catch (error) {
    db.exec('ROLLBACK');
    throw error;
  }
}
