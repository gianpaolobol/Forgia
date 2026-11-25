import {createHash, timingSafeEqual} from 'node:crypto';
import {lanPilotOrigin} from '../src/core/lanPilot.ts';

// The temporary LAN pilot accepts only a canonical RFC1918 IPv4 literal.
// Do not resolve hostnames or allow wildcard binds, ports or IPv6 here.
export function pilotBindHost(host: string): string {
  const origin = `https://${host}`;
  if (host.includes(':') || lanPilotOrigin(origin) !== origin) {
    throw Error('Il pilota richiede un indirizzo IPv4 privato esplicito.');
  }
  return host;
}

type Account = {id: string; sha256: string; expiresAt: number};

/** Validate the entire snapshot, including expired entries, before accepting any identity. */
export function validatePilotAccounts(entries: unknown): Account[] {
  const invalid = () => Error('Elenco tester pilota non valido.');
  if (!Array.isArray(entries)) throw invalid();
  const ids = new Set<string>(), digests = new Set<string>();
  const accounts: Account[] = [];
  for (const entry of entries) {
    if (!entry || typeof entry !== 'object' || Array.isArray(entry) ||
        typeof entry.id !== 'string' || !/^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/.test(entry.id) ||
        typeof entry.sha256 !== 'string' || !/^[a-f0-9]{64}$/.test(entry.sha256) ||
        typeof entry.expiresAt !== 'string' || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,9})?(?:Z|\+00:00)$/.test(entry.expiresAt)) throw invalid();
    const expiresAt = Date.parse(entry.expiresAt);
    if (!Number.isFinite(expiresAt) || new Date(expiresAt).toISOString().slice(0, 19) !== entry.expiresAt.slice(0, 19) ||
        ids.has(entry.id) || digests.has(entry.sha256)) throw invalid();
    ids.add(entry.id);
    digests.add(entry.sha256);
    accounts.push({id: entry.id, sha256: entry.sha256, expiresAt});
  }
  return accounts;
}

export function pilotIdentity(authorization: string | undefined, entries: unknown, now = Date.now()) {
  const token = /^Bearer ([a-f0-9]{64})$/.exec(authorization ?? '')?.[1];
  if (!token) return;
  const accounts = validatePilotAccounts(entries);
  const digest = createHash('sha256').update(token).digest();
  for (const entry of accounts) {
    if (entry.expiresAt > now && timingSafeEqual(digest, Buffer.from(entry.sha256, 'hex'))) return entry.id;
  }
}
