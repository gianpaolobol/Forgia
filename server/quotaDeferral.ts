// Server-only trusted classification of an explicit rate-limit refusal.
// No arbitrary error with status=429 is eligible for durable replay.
export const MAX_RETRY_DEADLINE = 253402300799999;
export function retryDeadline(header: string | null, now = Date.now()): number {
  if (!Number.isSafeInteger(now) || now < 0 || now > MAX_RETRY_DEADLINE - 60000) throw Error('Clock quota non valido.');
  let deadline = now + 60000;
  const value = header?.trim() ?? '';
  if (/^\d+$/.test(value)) {
    const seconds = Number(value);
    deadline = Math.max(deadline, Math.min(MAX_RETRY_DEADLINE, now + seconds * 1000));
  } else if (value) {
    const parsed = Date.parse(value);
    if (Number.isFinite(parsed) && new Date(parsed).toUTCString() === value) {
      deadline = Math.max(deadline, Math.min(MAX_RETRY_DEADLINE, parsed));
    }
  }
  return deadline;
}
export function nextUtcDay(now = Date.now()) {
  return Math.min(MAX_RETRY_DEADLINE, (Math.floor(now / 86400000) + 1) * 86400000);
}
export class ProviderError extends Error {
  readonly status?: number;
  constructor(message: string, status?: number) {
    super(message);
    this.status = status;
  }
}
export class QuotaDeferral extends ProviderError {
  readonly nextEligibleAt: number;
  constructor(nextEligibleAt: number, message = 'Quota o riserva raggiunta: lavoro sospeso.') {
    super(message, 429);
    if (!Number.isSafeInteger(nextEligibleAt) || nextEligibleAt < 0 || nextEligibleAt > MAX_RETRY_DEADLINE) throw Error('Deadline quota non valida.');
    this.nextEligibleAt = nextEligibleAt;
  }
}
