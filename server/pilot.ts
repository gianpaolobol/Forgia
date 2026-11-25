import {createHash, timingSafeEqual} from 'node:crypto';

export function pilotIdentity(authorization: string | undefined, entries: unknown, now = Date.now()) {
  const token = /^Bearer ([a-f0-9]{64})$/.exec(authorization ?? '')?.[1];
  if (!token || !Array.isArray(entries)) return;
  const digest = createHash('sha256').update(token).digest();
  for (const entry of entries) {
    if (!entry || typeof entry.id !== 'string' || !/^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/.test(entry.id) ||
        typeof entry.sha256 !== 'string' || !/^[a-f0-9]{64}$/.test(entry.sha256) ||
        typeof entry.expiresAt !== 'string' || !(Date.parse(entry.expiresAt) > now)) continue;
    if (timingSafeEqual(digest, Buffer.from(entry.sha256, 'hex'))) return entry.id;
  }
}
