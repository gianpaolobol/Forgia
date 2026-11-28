import type {DatabaseSync} from 'node:sqlite';
import {receiptIdentity} from '../src/core/receiptLookup.ts';

// Exact, read-only lookup, not a capability for remote callers. The HTTP
// boundary must allow this only on the trusted SQLite loopback listener.
export function findDurableReceipt(db: DatabaseSync, session: unknown, key: unknown): {id:string} | null {
  const identity = receiptIdentity(session,key);
  if (!identity) throw Object.assign(Error('Identificativi ricevuta non validi.'),{status:400});
  const row = db.prepare('SELECT id FROM forgia_jobs_v1 WHERE session=? AND request_key=?').get(identity.session,identity.key);
  return row ? {id:String(row.id)} : null;
}
