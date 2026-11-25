import {createHash} from 'node:crypto';
import {validateSpec,text,type AppSpec} from '../src/core/spec.ts';
import type {Storage} from '../src/core/storage.ts';
import {ProviderError, localProvider, providerIds, type Provider} from './providers.ts';
import {rankProviders, type RoutingContext} from './routing.ts';
import {normalizeRoutingStatus, summarizeRoutingFailure, type RoutingFailureStatus} from './routingFailure.ts';
import type {openQuotaLedger} from './quotaLedger.ts';
import type {openJobLedger} from './jobLedger.ts';
import {QuotaDeferral, nextUtcDay, retryDeadline} from './quotaDeferral.ts';
import {cloudCacheKey, type openCloudCache} from './cloudCache.ts';
type QuotaLedger = ReturnType<typeof openQuotaLedger>;
type CloudCache = ReturnType<typeof openCloudCache>;
type LocalCooldownLedger = Pick<ReturnType<typeof openJobLedger>,'localCooldownUntil'|'recordLocalCooldown'>;
type SpecCache = Record<string, AppSpec>;
interface State {version:1;day:string;counts:Record<string,number>;cache:SpecCache;pilotCache:SpecCache}
const queues=new WeakMap<Storage,Promise<unknown>>();
export function createGateway(store:Storage,{dailyLimit,quotaLedger,cloudCache,localCooldownLedger}:{dailyLimit?:number;quotaLedger?:QuotaLedger;cloudCache?:CloudCache;localCooldownLedger?:LocalCooldownLedger}={}){
 if(cloudCache&&!quotaLedger)throw Error('Cache cloud richiede il registro quote SQLite.');
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
 const cooldownUntil = (id:string) => localCooldownLedger && localProvider(id) ? localCooldownLedger.localCooldownUntil(id) : (cooldowns.get(id)??0);
 function recordCooldown(id:string,until:number) {
  if(localCooldownLedger&&localProvider(id)) localCooldownLedger.recordLocalCooldown(id,until);
  else cooldowns.set(id,Math.max(cooldownUntil(id),until));
 }
 const cloudLimit = Math.min(dailyLimit ?? 20,20);
 // Opt-in only: every cloud caller must share the initialized ledger after an offline cutover.
 // The legacy JSON cloud cache/counters are not authoritative in this mode.
 async function attemptSqliteCloud(prompt:string, provider:Provider, signal:AbortSignal, reserve:number,scope?:string) {
  const before = quotaLedger!.read(provider.id);
  if (before.cooldownUntil > Date.now() || before.used >= cloudLimit-reserve) {
   throw new QuotaDeferral(Math.max(before.cooldownUntil, before.used >= cloudLimit-reserve ? nextUtcDay() : retryDeadline(null)));
  }
  if (!await provider.eligible(signal)) throw new ProviderError('Fornitore gratuito non verificato.',403);
  signal.throwIfAborted();
  const key=cloudCache ? cloudCacheKey(provider.id,provider.model,prompt,scope) : undefined;
  if (key) {
   const cached=cloudCache!.read(key);
   if (cached!==undefined) return {spec:validateSpec(cached),cached:true,requestsUsed:quotaLedger!.read(provider.id).used};
  }
  const grant = quotaLedger!.reserve(provider.id,cloudLimit,reserve);
  if (!grant.granted) throw new QuotaDeferral(grant.reason==='cooldown'?grant.nextEligibleAt!:nextUtcDay());
  signal.throwIfAborted(); // Never refund a committed grant, even before dispatch.
  let output:string;
  try { output = await provider.complete(prompt,signal); }
  catch (error) {
   if (error instanceof ProviderError && error.status===429) {
    quotaLedger!.cooldown(provider.id,Math.max(retryDeadline(null),error instanceof QuotaDeferral?error.nextEligibleAt:0));
   }
   throw error;
  }
  signal.throwIfAborted();
  let spec:AppSpec;
  try { spec=validateSpec(JSON.parse(output)); }
  catch { throw new ProviderError('Il modello ha restituito una specifica non valida.',502); }
  if (key) cloudCache!.write(key,spec);
  return {spec,cached:false,requestsUsed:grant.used};
 }
 async function attempt(prompt: string, provider: Provider, consent: boolean, state: State, signal: AbortSignal, scope?: string, reserve = 0) {
  signal.throwIfAborted();
  if (!providerIds.includes(provider.id) || !['local', 'free'].includes(provider.mode)) {
   throw Error('Fornitore non supportato in modalità gratuita.');
  }
  if (localProvider(provider.id) !== (provider.mode === 'local')) throw Error('Modalità gratuita incoerente.');
  if (provider.mode !== 'local' && !consent) throw Error('Serve il consenso all’invio al fornitore cloud selezionato.');
  if (quotaLedger && provider.mode === 'free') return attemptSqliteCloud(prompt,provider,signal,reserve,scope);
  const key = createHash('sha256').update(JSON.stringify(scope ? [scope, provider.id, provider.model, prompt] : [provider.id, provider.model, prompt])).digest('hex');
  const used = state.counts[provider.id] ?? 0;
  const cache = scope ? state.pilotCache : state.cache;
  if (cache[key]) return {spec: validateSpec(cache[key]), cached: true, requestsUsed: used};
  if (cooldownUntil(provider.id) > Date.now()) throw new QuotaDeferral(cooldownUntil(provider.id));
  if (used >= limit(provider)) throw new QuotaDeferral(nextUtcDay());
  if (!await provider.eligible(signal)) throw new ProviderError('Fornitore gratuito non verificato.', 403);
  signal.throwIfAborted();
  state.counts[provider.id] = used + 1;
  await store.setItem('gateway.v1', JSON.stringify(state));
  let output: string;
  try {
   output = await provider.complete(prompt, signal);
  } catch (error) {
   if (error instanceof ProviderError && error.status === 429) recordCooldown(provider.id, Math.max(retryDeadline(null),error instanceof QuotaDeferral?error.nextEligibleAt:0));
   throw error;
  }
  signal.throwIfAborted();
  let spec: AppSpec;
  try {
   spec = validateSpec(JSON.parse(output));
  } catch {
   throw new ProviderError('Il modello ha restituito una specifica non valida.', 502);
  }
  cache[key] = spec;
  const keys = Object.keys(cache);
  if (keys.length > 100) delete cache[keys[0]];
  await store.setItem('gateway.v1', JSON.stringify(state));
  return {spec, cached: false, requestsUsed: state.counts[provider.id]};
 }

 function plan(idea: string, provider: Provider, consent: boolean, scope?: string, external?: AbortSignal) {
  return enqueue(async () => {
   try {
    external?.throwIfAborted();
    const signal = AbortSignal.any([AbortSignal.timeout(45000), ...(external ? [external] : [])]);
    return await attempt(text(idea, 'Idea', 8000), provider, consent, await load(), signal, scope);
   } catch (error) {
    if (error instanceof DOMException && error.name === 'TimeoutError') {
     const failure = summarizeRoutingFailure([504]);
     throw new ProviderError(failure.message, failure.status);
    }
    if (error instanceof ProviderError && normalizeRoutingStatus(error.status) !== error.status) {
     const failure = summarizeRoutingFailure([normalizeRoutingStatus(error.status)]);
     throw new ProviderError(failure.message, failure.status);
    }
    throw error;
   }
  });
 }

 function planAuto(idea: string, providers: readonly Provider[], consent: boolean, context: RoutingContext, backlog = -1, scope?: string, external?: AbortSignal) {
  return enqueue(async () => {
   external?.throwIfAborted();
   const deadline = AbortSignal.any([AbortSignal.timeout(90000), ...(external ? [external] : [])]);
   const prompt = text(idea, 'Idea', 8000);
   const state = await load();
   const remaining = Object.fromEntries(providers.map(p => {
    if (quotaLedger && p.mode==='free' && providerIds.includes(p.id) && !localProvider(p.id) && consent) {
     const current=quotaLedger.read(p.id);
     return [p.id,current.cooldownUntil>Date.now()?0:cloudLimit-current.used];
    }
    return [p.id,cooldownUntil(p.id)>Date.now()?0:limit(p)-(state.counts[p.id]??0)];
   }));
   const reserve = backlog>=0 && context.kind==='catalog' && context.phase==='draft' && Buffer.byteLength(prompt)<=2000 ? Math.min(cloudLimit,backlog>=2?8:4) : 0;
   const ranked = rankProviders(providers, context, prompt, consent, remaining, backlog);
   if (!ranked.length) {
    // Re-rank without quota constraints to distinguish a quota exclusion from policy/capability.
    const unlimited = Object.fromEntries(providers.map(p => [p.id, Infinity]));
    const compatible = rankProviders(providers, context, prompt, consent, unlimited, backlog);
    if (compatible.length) {
      const deadlines = compatible.map(({provider:p}) => {
        if (quotaLedger && p.mode==='free') {
          const state=quotaLedger.read(p.id);
          return Math.max(state.cooldownUntil,state.used>=cloudLimit-reserve?nextUtcDay():retryDeadline(null));
        }
        return Math.max(cooldownUntil(p.id), (state.counts[p.id]??0)>=limit(p)-(p.mode==='free'?reserve:0)?nextUtcDay():retryDeadline(null));
      });
      throw new QuotaDeferral(Math.max(...deadlines));
    }
    throw new ProviderError('Nessun motore gratuito compatibile: verifica configurazione, consenso e capacità.',503);
   }
   const skipped: string[] = [];
   const failures: RoutingFailureStatus[] = [];
   const deferrals: number[] = [];
   for (const {provider, reason} of ranked) {
    if (deadline.aborted) {
     failures.push(504);
     break;
    }
    try {
     const result = await attempt(prompt, provider, consent, state, AbortSignal.any([deadline, AbortSignal.timeout(provider.mode === "local" ? 45000 : 14000)]), scope, reserve);
     return {...result, routing: {provider: provider.id, model: provider.model, reason, skipped}};
    } catch (error) {
     // Remote errors may permit a free fallback. Storage and policy errors stop the request.
     if (!(error instanceof ProviderError) && !(error instanceof DOMException && error.name === 'TimeoutError')) throw error;
     failures.push(error instanceof ProviderError ? normalizeRoutingStatus(error.status) : 504);
     if (error instanceof QuotaDeferral) deferrals.push(error.nextEligibleAt);
     skipped.push(provider.id);
    }
   }
   if (!deadline.aborted && deferrals.length>0 && deferrals.length===failures.length) throw new QuotaDeferral(Math.max(...deferrals));
   const failure = summarizeRoutingFailure(failures);
   throw new ProviderError(failure.message, failure.status);
  });
 }

 return {plan, planAuto};
}
