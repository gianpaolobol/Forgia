import {randomUUID} from 'node:crypto';
import type {Storage} from '../src/core/storage.ts';
import {text} from '../src/core/spec.ts';
import {providerIds} from './providers.ts';
import {routingContext, type RoutingContext} from './routing.ts';

type Input = {idea: string; provider: string; consent: boolean; context: RoutingContext};
type Job<R> = {id: string; session: string; requestKey?: string} & (
  {status: 'queued' | 'running'; input: Input} |
  {status: 'done'; result: R} |
  {status: 'failed'; error: string; statusCode?: number}
);
const key = 'jobs.v1';
const sessionPattern = /^[a-f0-9-]{36}$/i;

export function createJobs<R>(store: Storage, run: (input: Input, backlog: number, session: string) => Promise<R>) {
  let writes = Promise.resolve<unknown>(undefined);
  let worker: Promise<void> | undefined;
  let lastSession: string | undefined;
  let jobs: Job<R>[];
  const ready = (async () => {
    const raw = await store.getItem(key);
    const saved: Job<R>[] = raw === null ? [] : JSON.parse(raw);
    if (!Array.isArray(saved)) throw Error('Coda locale non valida.');
    jobs = saved.map(job => job.status === 'running'
      ? {id: job.id, session: job.session, requestKey: job.requestKey, status: 'failed', error: 'Lavoro interrotto dal riavvio. Puoi inviarlo di nuovo.'}
      : job);
    if (saved.some(job => job.status === 'running')) await store.setItem(key, JSON.stringify(jobs));
  })();

  function locked<T>(work: () => T | Promise<T>): Promise<T> {
    const result = writes.then(() => ready).then(work);
    writes = result.catch(() => {});
    return result;
  }

  async function save(next: Job<R>[]) {
    const retained: Job<R>[] = next.filter(job => job.status === 'done' || job.status === 'failed').slice(-32);
    const kept = next.filter(job => job.status === 'queued' || job.status === 'running' || retained.includes(job));
    await store.setItem(key, JSON.stringify(kept));
    jobs = kept;
  }

  async function drain() {
    while (true) {
      const task = await locked(async () => {
        const queued = jobs.flatMap(job => job.status === 'queued' ? [job] : []);
        const job = queued.find(item => item.session !== lastSession) ?? queued[0];
        if (!job) return;
        await save(jobs.map(item => item === job ? {...job, status: 'running'} : item));
        lastSession = job.session;
        return {job, backlog: queued.length - 1};
      });
      if (!task) return;
      const {job, backlog} = task;
      const identity = {id: job.id, session: job.session, requestKey: job.requestKey};
      let terminal: Job<R>;
      try {
        terminal = {...identity, status: 'done', result: await run(job.input, backlog, job.session)};
      } catch (error) {
        terminal = {...identity, status: 'failed',
          error: error instanceof Error && !('code' in error) ? error.message : 'Elaborazione non riuscita.',
          statusCode: error instanceof Error && 'status' in error && error.status === 429 ? 429 : undefined};
      }
      await locked(async () => {
        const next = jobs.filter(item => item.id !== job.id);
        try {
          await save(next.concat(terminal));
        } catch (error) {
          jobs = next.concat({...identity, status: 'failed', error: 'Impossibile salvare il risultato della richiesta.'});
          throw error;
        }
      });
    }
  }

  function start() {
    if (worker) return;
    worker = drain().then(() => {
      worker = undefined;
      if (jobs.some(job => job.status === 'queued')) start();
    }, () => {
      worker = undefined;
      console.error('Elaborazione della coda interrotta. Verifica la persistenza locale.');
    });
  }
  start();

  return {
    async submit(body: Record<string, unknown>, requestKey?: string) {
      const idea = text(body.idea, 'Idea', 8000);
      const {session, provider} = body;
      if (typeof session !== 'string' || !sessionPattern.test(session)) throw Error('Sessione di lavoro non valida.');
      if (typeof provider !== 'string' || (provider !== 'auto' && !providerIds.includes(provider))) throw Error('Motore non valido.');
      const input = {idea, provider, consent: body.cloudConsent === true, context: routingContext(body.kind, body.phase)};
      const id = await locked(async () => {
        const previous = requestKey && jobs.findLast(job => job.session === session && job.requestKey === requestKey);
        if (previous && previous.status !== 'failed') return previous.id;
        const id = randomUUID();
        const active = jobs.filter(job => job.status === 'queued' || job.status === 'running');
        if (active.length >= 16 || active.filter(job => job.session === session).length >= 3) {
          throw Object.assign(Error('Coda piena. Attendi la fine di un lavoro prima di inviarne un altro.'), {status: 429});
        }
        await save([...jobs, {id, session, requestKey, status: 'queued', input}]);
        return id;
      });
      start();
      return {id};
    },
    read(id: string, session?: string) {
      return locked(() => {
        const job = jobs.find(item => item.id === id);
        if (!job || (session !== undefined && job.session !== session)) return null;
        if (job.status === 'done') return {status: job.status, result: job.result};
        if (job.status === 'failed') return {status: job.status, error: job.error, statusCode: job.statusCode};
        return {status: job.status};
      });
    },
  };
}
