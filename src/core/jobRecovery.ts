import {lanPilotOrigin} from './lanPilot.ts';

const loopback = 'http://127.0.0.1:8787';
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
type Context = {origin: string; session?: string; protectedLocal?: true};
export type JobRecovery = Context & (
  {state: 'submitting'} | {state: 'accepted'; id: string} | {state: 'closed'}
);

/** Persist only the receipt and routing context, never a bearer or provider key. */
export function decodeJobRecovery(value: unknown): JobRecovery {
  if (!value || typeof value !== 'object') throw Error('Ricevuta AI non valida.');
  const {origin, session, state, id, protectedLocal} = value as Record<string, unknown>;
  if (typeof origin !== 'string' || (origin !== loopback && lanPilotOrigin(origin) !== origin)
    || (origin === loopback ? typeof session !== 'string' || !uuid.test(session) : session !== undefined)) {
    throw Error('Origine o sessione della ricevuta AI non valida.');
  }
  if (protectedLocal !== undefined && (protectedLocal !== true || origin !== loopback)) throw Error('Modalità ricevuta non valida.');
  const context: Context = {origin, ...(typeof session === 'string' ? {session} : {}), ...(protectedLocal === true ? {protectedLocal:true} : {})};
  if (state === 'accepted' && typeof id === 'string' && uuid.test(id)) return {...context,state,id};
  if ((state === 'submitting' || state === 'closed') && id === undefined) return {...context,state};
  throw Error('Stato della ricevuta AI non valido.');
}

export function recoveryAction(job: JobRecovery | undefined, origin: string): 'submit' | 'poll' | 'blocked' {
  if (!job) return 'submit';
  return job.origin === origin && job.state === 'accepted' ? 'poll' : 'blocked';
}

export function closeJob(job: JobRecovery): JobRecovery {
  return {origin:job.origin, ...(job.session ? {session:job.session} : {}), ...(job.protectedLocal ? {protectedLocal:true} : {}), state:'closed'};
}
