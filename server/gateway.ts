import {createHash} from 'node:crypto';
import {validateSpec,text,type AppSpec} from '../src/core/spec.ts';
import type {Storage} from '../src/core/storage.ts';
import type {Provider} from './providers.ts';
interface State {version:1;day:string;counts:Record<string,number>;cache:Record<string,AppSpec>}
const queues=new WeakMap<Storage,Promise<unknown>>();
export function createGateway(store:Storage,{dailyLimit=20}:{dailyLimit?:number}={}){
 if(!Number.isSafeInteger(dailyLimit)||dailyLimit<1||dailyLimit>100)throw Error('Quota locale non valida.');
 async function load():Promise<State>{
  const raw=await store.getItem('gateway.v1'),day=new Date().toISOString().slice(0,10);
  if(raw===null)return {version:1,day,counts:{},cache:{}};
  try {
   const d=JSON.parse(raw),record=(v:unknown)=>v!==null&&typeof v==='object'&&!Array.isArray(v);
   if(!record(d)||d.version!==1||typeof d.day!=='string'||!/^\d{4}-\d{2}-\d{2}$/.test(d.day)||!Number.isFinite(Date.parse(d.day))||d.day>day||!record(d.counts)||!record(d.cache)||Object.keys(d.cache).length>100)throw Error();
   if(Object.entries(d.counts).some(([k,n])=>!['local','groq','openrouter'].includes(k)||!Number.isSafeInteger(n)||Number(n)<0))throw Error();
   for(const [key,spec] of Object.entries(d.cache)){if(!/^[0-9a-f]{64}$/.test(key))throw Error();validateSpec(spec);}
   return {version:1,day,counts:d.day===day?d.counts:{},cache:d.cache};
  }catch{throw Error('Stato quota corrotto: recupero manuale necessario, nessun invio.');}
 }
 function plan(idea:string,p:Provider,cloudConsent:boolean):Promise<{spec:AppSpec;cached:boolean;requestsUsed:number}>{
  const run=(queues.get(store)??Promise.resolve()).then(async()=>{
   const prompt=text(idea,'Idea',8000);
   if(!['local','groq','openrouter'].includes(p.id)||!['local','free'].includes(p.mode))throw Error('Fornitore non supportato in modalità gratuita.');
   if((p.id==='local')!==(p.mode==='local'))throw Error('Modalità gratuita incoerente.');
   if(p.mode!=='local'&&!cloudConsent)throw Error('Serve il consenso all’invio al fornitore cloud selezionato.');
   const state=await load(),key=createHash('sha256').update(JSON.stringify([p.id,p.model,prompt])).digest('hex');
   if(state.cache[key])return {spec:validateSpec(state.cache[key]),cached:true,requestsUsed:state.counts[p.id]??0};
   if((state.counts[p.id]??0)>=dailyLimit)throw Object.assign(Error('Quota giornaliera locale raggiunta: lavoro sospeso.'),{status:429});
   if(!await p.eligible())throw Error('Fornitore gratuito non verificato.');
   state.counts[p.id]=(state.counts[p.id]??0)+1;
   await store.setItem('gateway.v1',JSON.stringify(state));
   const output=await p.complete(prompt,AbortSignal.timeout(45000));
   const spec=validateSpec(JSON.parse(output));state.cache[key]=spec;
   const keys=Object.keys(state.cache);if(keys.length>100)delete state.cache[keys[0]];
   await store.setItem('gateway.v1',JSON.stringify(state));
   return {spec,cached:false,requestsUsed:state.counts[p.id]};
  });queues.set(store,run.catch(()=>{}));return run;
 }
 return {plan};
}
