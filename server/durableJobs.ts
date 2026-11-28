import {randomUUID} from 'node:crypto';
import {mkdirSync, lstatSync, openSync, closeSync} from 'node:fs';
import {join} from 'node:path';
import {openJobLedger} from './jobLedger.ts';
import {durableInputPayload,durableModelAllowed} from './durableInput.ts';
import {runOneDurableJob, type DurableInput} from './durableWorker.ts';
import {routingContext} from './routing.ts';
import type {JobAuthorization} from './jobAuthorization.ts';
import {type ExplicitCloudPolicy, cloudSessionAllowed} from './explicitCloudPolicy.ts';

type Ledger = ReturnType<typeof openJobLedger>;
const sessionPattern = /^[a-f0-9-]{36}$/i;

// Dedicated loopback-only queue. Offline preparation is explicit; no silent
// re-creation of a missing database on a normal restart.
export function prepareLocalLedger(directory: string, snapshot: string, initialize: boolean) {
  mkdirSync(directory,{recursive:true,mode:0o700});
  const dir = lstatSync(directory);
  if (!dir.isDirectory() || (process.platform !== 'win32' && (dir.mode & 0o077))) throw Error('Directory SQLite non privata.');
  const path = join(directory,'jobs.sqlite');
  if (initialize) closeSync(openSync(path,'wx',0o600));
  const file = lstatSync(path);
  if (!file.isFile() || (process.platform !== 'win32' && (file.mode & 0o077))) throw Error('File SQLite non privato.');
  for (const suffix of ['-wal','-shm']) {
    try {
      const side = lstatSync(path+suffix);
      if (!side.isFile() || (process.platform !== 'win32' && (side.mode & 0o077))) throw Error('File SQLite ausiliario non privato.');
    } catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; }
  }
  const ledger = openJobLedger(path);
  try { ledger.importLegacy(snapshot,!initialize); return ledger; }
  catch (error) { ledger.close(); throw error; }
}

export function createDurableLocalJobs(ledger: Ledger, run: (input: DurableInput, backlog: number, session: string, signal: AbortSignal) => Promise<unknown>, modelFor?: (provider:string)=>string|undefined, authorize?: JobAuthorization, cloudPolicy?: ExplicitCloudPolicy) {
  if(cloudPolicy&&!authorize)throw Error('Cloud esplicito richiede autorizzazioni persistenti.');
  const cloudAllowed=(session:string)=>cloudSessionAllowed(cloudPolicy,session);
  const worker = randomUUID();
  async function grantAllowed(session:string,grant:string|undefined) {
    if(!authorize)return grant===undefined;
    if(!grant||!/^[a-f0-9]{64}$/.test(grant))return false;
    try{return await authorize(session,grant)===true;}catch{return false;}
  }
  async function visible(row:NonNullable<ReturnType<Ledger['read']>>,session:string|undefined,grant:string|undefined) {
    let bound:string|undefined;
    try{if(row.payload)bound=(JSON.parse(row.payload) as DurableInput).authorizationGrant;}catch{return false;}
    if(!authorize)return bound===undefined&&grant===undefined;
    return session===row.session&&bound!==undefined&&bound===grant&&await grantAllowed(row.session,bound);
  }
  let running = false;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let active: Promise<void> | undefined;
  const execute = async () => {
    try {
      const outcome = await runOneDurableJob(ledger,{
        worker,
        authorize: async (session,input) => (input.provider!=='openrouter'||input.expectedModel===cloudPolicy?.model)&&durableModelAllowed(input,modelFor,cloudAllowed(session))&&await grantAllowed(session,input.authorizationGrant),
        run: (input,session,signal) => run({...input,consent:input.provider==='openrouter'&&input.consent===true},ledger.queuedCount(),session,signal),
      });
      if (running) timer=setTimeout(tick,outcome==='idle'?500:0);
    } catch {
      running=false;
      console.error('Coda SQLite sospesa: verificare il database prima del riavvio.');
    }
  };
  function tick() { active=execute(); }
  return {
    start() { if (!running) {running=true;tick();} },
    async stop() {running=false;clearTimeout(timer);await active;},
    async submit(body: Record<string,unknown>, requestKey?: string, grant?:string) {
      if (!running) throw Object.assign(Error('Coda non disponibile.'),{status:503});
      const {session,provider,idea}=body;
      if (typeof session!=='string' || !sessionPattern.test(session)) throw Error('Sessione di lavoro non valida.');
      if (typeof provider!=='string' || (!['auto','local','llamacpp'].includes(provider)&&!(provider==='openrouter'&&cloudAllowed(session)))) throw Error('Motore non autorizzato in modalità SQLite.');
      if(provider==='openrouter'&&(body.cloudConsent!==true||body.expectedModel!==cloudPolicy?.model||grant===undefined))throw Error('Cloud esplicito richiede consenso, modello fissato e grant.');
      if (requestKey!==undefined && (typeof requestKey!=='string' || !requestKey || requestKey.length>1000)) throw Error('Chiave richiesta non valida.');
      if(!await grantAllowed(session,grant))throw Object.assign(Error('Autorizzazione locale non valida.'),{status:403});
      const payload=durableInputPayload({idea:typeof idea==='string'?idea.trim():idea,provider,consent:provider==='openrouter'&&body.cloudConsent===true,context:routingContext(body.kind,body.phase),...(Object.hasOwn(body,'expectedModel')?{expectedModel:body.expectedModel}:{}),...(grant!==undefined?{authorizationGrant:grant}:{})});
      if (!durableModelAllowed(JSON.parse(payload),modelFor,cloudAllowed(session))) throw Object.assign(Error('Modello locale non corrispondente al pin.'),{status:409});
      return {id:ledger.enqueue(session,requestKey??null,payload)};
    },
    async findReceipt(session:unknown,key:unknown,grant?:string) {
      const receipt=ledger.findReceipt(session,key);
      if(!receipt||typeof session!=='string')return null;
      const row=ledger.read(receipt.id,session);
      return row&&await visible(row,session,grant)?receipt:null;
    },
    async read(id: string, session?: string, grant?:string) {
      const row=session===undefined?ledger.readLocal(id):ledger.read(id,session);
      if (!row||!await visible(row,session,grant)) return null;
      if (row.status==='done') return {status:'done' as const,result:JSON.parse(row.result!) as unknown};
      if (row.status==='failed') {
        const result=JSON.parse(row.result!) as {error?:string;statusCode?:number};
        return {status:'failed' as const,error:result.error,statusCode:result.statusCode};
      }
      if (row.status==='uncertain') return {status:'failed' as const,error:'Esito incerto: non è stato ripetuto automaticamente. Verifica prima di inviare una nuova richiesta.',statusCode:409};
      const nextEligibleAt = ledger.deferredUntil(id);
      return {status:row.status==='queued'?'queued' as const:'running' as const,...(nextEligibleAt!==undefined?{nextEligibleAt}: {})};
    },
  };
}
