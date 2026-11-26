import type {openJobLedger} from './jobLedger.ts';
import {durableInputPayload,type DurableInput} from './durableInput.ts';
import {QuotaDeferral, retryDeadline} from './quotaDeferral.ts';

type Ledger = ReturnType<typeof openJobLedger>;
export type {DurableInput} from './durableInput.ts';
type Options = {
  worker: string;
  authorize: (session: string, input: DurableInput) => Promise<boolean>;
  run: (input: DurableInput, session: string, signal: AbortSignal) => Promise<unknown>;
  ttl?: number;
  maxRunMs?: number;
  now?: () => number;
};
type Outcome = 'idle' | 'failed' | 'done' | 'uncertain' | 'lease-lost' | 'deferred';

// Explicit one-shot worker, not an HTTP listener or automatic migration.
// Authorization is a fresh check at dispatch, not a guarantee of in-flight revocation.
// The caller must enforce provider policy/quotas and honour cancellation in run().
export async function runOneDurableJob(ledger: Ledger, options: Options): Promise<Outcome> {
  const ttl = options.ttl ?? 30000, maxRunMs = options.maxRunMs ?? 120000;
  if (!Number.isSafeInteger(ttl) || ttl < 30 || ttl > 300000 || !Number.isSafeInteger(maxRunMs) || maxRunMs < 1 || maxRunMs > 300000) throw Error('Tempi worker non validi.');
  const now = options.now ?? Date.now;
  const row = ledger.claim(options.worker, now(), ttl);
  if (!row) return 'idle';
  const lease = {id:row.id, fence:row.fence, worker:options.worker};
  const fail = (error: string, statusCode: number): Outcome => ledger.failClaim(lease,now(),JSON.stringify({error,statusCode})) ? 'failed' : 'lease-lost';
  let input: DurableInput;
  try { input = JSON.parse(durableInputPayload(JSON.parse(row.payload))); }
  catch { return fail('Richiesta in coda non valida.',400); }
  let authorized: boolean;
  let authTimer: ReturnType<typeof setTimeout> | undefined;
  try {
    const expired = new Promise<never>((_,reject) => { authTimer = setTimeout(() => reject(Error('Autorizzazione scaduta.')),ttl); });
    authorized = await Promise.race([Promise.resolve().then(() => options.authorize(row.session,input)),expired]);
  } catch { return fail('Autorizzazione non verificabile.',503); }
  finally { clearTimeout(authTimer); }
  if (authorized !== true) return fail('Autorizzazione non più valida.',403);
  // A stale claimant must never execute, including after a slow authorization check.
  if (!ledger.markDispatched(lease,now())) return 'lease-lost';
  const controller = new AbortController();
  const heartbeat = setInterval(() => {
    try { if (ledger.heartbeat(lease,now(),ttl)) return; } catch { /* fail closed */ }
    controller.abort();
  }, Math.floor(ttl/3));
  const deadline = setTimeout(() => controller.abort(),maxRunMs);
  const stopped = new Promise<never>((_,reject) => controller.signal.addEventListener('abort',() => reject(Error('Worker interrotto.')),{once:true}));
  try {
    let result: string;
    try {
      const value = await Promise.race([Promise.resolve().then(() => options.run(input,row.session,controller.signal)), stopped]);
      if (controller.signal.aborted) throw Error('Worker interrotto.');
      result = JSON.stringify(value);
      if (typeof result !== 'string' || Buffer.byteLength(result) > 4 * 1024 * 1024) throw Error('Risultato non valido.');
    } catch (error) {
      // Only the trusted explicit refusal type permits a bounded replay.
      // Cancellation/transport failure may hide an effect and stays uncertain.
      if (!controller.signal.aborted && error instanceof QuotaDeferral) {
        const at = now();
        const outcome = ledger.deferQuota(lease,at,Math.max(error.nextEligibleAt,retryDeadline(null,at)));
        return outcome === 'exhausted' ? 'failed' : outcome;
      }
      return ledger.markUncertain(lease,now()) ? 'uncertain' : 'lease-lost';
    }
    return ledger.finish(lease,now(),'done',result) ? 'done' : 'lease-lost';
  } finally {
    clearInterval(heartbeat);
    clearTimeout(deadline);
  }
}
