import {createHash} from 'node:crypto';
import {validateSpec,text,type AppSpec} from '../src/core/spec.ts';
import type {Storage} from '../src/core/storage.ts';
import {ProviderError, localProvider, providerIds, type Provider} from './providers.ts';
import {rankProviders, type RoutingContext} from './routing.ts';
type SpecCache = Record<string, AppSpec>;
interface State {version:1;day:string;counts:Record<string,number>;cache:SpecCache;pilotCache:SpecCache}
const queues=new WeakMap<Storage,Promise<unknown>>();
export function createGateway(store:Storage,{dailyLimit}:{dailyLimit?:number}={}){
 if(dailyLimit!==undefined&&(!Number.isSafeInteger(dailyLimit)||dailyLimit<1||dailyLimit>100))throw Error('Quota locale non valida.');
 async function load():Promise<State>{
  const raw=await store.getItem('gateway.v1'),day=new Date().toISOString().slice(0,10);
  if(raw===null)return {version:1,day,counts:{},cache:{},pilotCache:{}};
  try {
   const d=JSON.parse(raw),record=(v:unknown)=>v!==null&&typeof v==='object'&&!Array.isArray(v);
   if(!record(d)||d.version!==1||typeof d.day!=='string'||!/^\d{4}-\d{2}-\d{2}$/.test(d.day)||!Number.isFinite(Date.parse(d.day))||d.day>day||!record(d.counts))throw Error();
   if(Object.entries(d.counts).some(([k,n])=>!providerIds.includes(k)||!Number.isSafeInteger(n)||Number(n)<0))throw Error();
   const pilotCache = d.pilotCache === undefined ? {} : d.pilotCache;
   for (const cache of [d.cache, pilotCache]) {
    if (!record(cache) || Object.keys(cache).length > 100) throw Error();
    for (const [key, spec] of Object.entries(cache)) {
     if (!/^[0-9a-f]{64}$/.test(key)) throw Error();
     validateSpec(spec);
    }
   }
   return {version:1,day,counts:d.day===day?d.counts:{},cache:d.cache,pilotCache};
  }catch{throw Error('Stato quota corrotto: recupero manuale necessario, nessun invio.');}
 }
 function enqueue<T>(work: () => Promise<T>): Promise<T> {
  const run = (queues.get(store) ?? Promise.resolve()).then(work);
  queues.set(store, run.catch(() => {}));
  return run;
 }

 const limit = (provider: Provider) => dailyLimit ?? (provider.mode === 'local' ? Infinity : 20);
 const cooldowns = new Map<string, number>();
 async function attempt(prompt: string, provider: Provider, consent: boolean, state: State, signal: AbortSignal, scope?: string) {
  if (!providerIds.includes(provider.id) || !['local', 'free'].includes(provider.mode)) {
   throw Error('Fornitore non supportato in modalità gratuita.');
  }
  if (localProvider(provider.id) !== (provider.mode === 'local')) throw Error('Modalità gratuita incoerente.');
  if (provider.mode !== 'local' && !consent) throw Error('Serve il consenso all’invio al fornitore cloud selezionato.');
  const key = createHash('sha256').update(JSON.stringify(scope ? [scope, provider.id, provider.model, prompt] : [provider.id, provider.model, prompt])).digest('hex');
  const used = state.counts[provider.id] ?? 0;
  const cache = scope ? state.pilotCache : state.cache;
  if (cache[key]) return {spec: validateSpec(cache[key]), cached: true, requestsUsed: used};
  if ((cooldowns.get(provider.id) ?? 0) > Date.now()) throw new ProviderError('Motore in pausa dopo un limite remoto.', 429);
  if (used >= limit(provider)) throw new ProviderError('Quota giornaliera locale raggiunta: lavoro sospeso.', 429);
  if (!await provider.eligible(signal)) throw new ProviderError('Fornitore gratuito non verificato.');
  signal.throwIfAborted();
  state.counts[provider.id] = used + 1;
  await store.setItem('gateway.v1', JSON.stringify(state));
  let output: string;
  try {
   output = await provider.complete(prompt, signal);
  } catch (error) {
   if (error instanceof ProviderError && error.status === 429) cooldowns.set(provider.id, Date.now() + 60_000);
   throw error;
  }
  let spec: AppSpec;
  try {
   spec = validateSpec(JSON.parse(output));
  } catch {
   throw new ProviderError('Il modello ha restituito una specifica non valida.');
  }
  cache[key] = spec;
  const keys = Object.keys(cache);
  if (keys.length > 100) delete cache[keys[0]];
  await store.setItem('gateway.v1', JSON.stringify(state));
  return {spec, cached: false, requestsUsed: state.counts[provider.id]};
 }

 function plan(idea: string, provider: Provider, consent: boolean, scope?: string) {
  return enqueue(async () => attempt(text(idea, 'Idea', 8000), provider, consent, await load(), AbortSignal.timeout(45000), scope));
 }

 function planAuto(idea: string, providers: readonly Provider[], consent: boolean, context: RoutingContext, backlog = -1, scope?: string) {
  return enqueue(async () => {
   const deadline = AbortSignal.timeout(90000);
   const prompt = text(idea, 'Idea', 8000);
   const state = await load();
   const remaining = Object.fromEntries(providers.map(p => [p.id, (cooldowns.get(p.id) ?? 0) > Date.now() ? 0 : limit(p) - (state.counts[p.id] ?? 0)]));
   const ranked = rankProviders(providers, context, prompt, consent, remaining, backlog);
   if (!ranked.length) {
    throw new ProviderError('Nessun motore gratuito disponibile per questa richiesta. Verifica configurazione, consenso e quote.', 429);
   }
   const skipped: string[] = [];
   for (const {provider, reason} of ranked) {
    deadline.throwIfAborted();
    try {
     const result = await attempt(prompt, provider, consent, state, AbortSignal.any([deadline, AbortSignal.timeout(provider.mode === "local" ? 45000 : 14000)]), scope);
     return {...result, routing: {provider: provider.id, model: provider.model, reason, skipped}};
    } catch (error) {
     // Remote errors may permit a free fallback. Storage and policy errors stop the request.
     if (!(error instanceof ProviderError) && !(error instanceof DOMException && error.name === 'TimeoutError')) throw error;
     skipped.push(provider.id);
    }
   }
   throw new ProviderError('I motori gratuiti compatibili non hanno completato la richiesta.', 429);
  });
 }

 return {plan, planAuto};
}
