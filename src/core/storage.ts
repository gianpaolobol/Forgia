import { validateSpec, type Project } from './spec.ts';
export interface Storage {getItem(key:string):Promise<string|null>;setItem(key:string,value:string):Promise<void>}
const PRIMARY='forgia.projects.v1',BACKUP=PRIMARY+'.backup';
function decode(raw:string):Project[]{
 const data=JSON.parse(raw);
 if(data.version!==1||!Array.isArray(data.projects))throw Error('Formato salvataggio non valido');
 const ids=new Set<string>();
 return data.projects.map((p:Project)=>{
  if(typeof p.id!=='string'||!p.id||ids.has(p.id))throw Error('Identificativo progetto non valido');ids.add(p.id);
  const revisions=p.revisions?.map(r=>{if(typeof r.id!=='string'||typeof r.instruction!=='string'||!Number.isFinite(Date.parse(r.createdAt)))throw Error('Cronologia non valida');return {...r,spec:validateSpec(r.spec)};});
  if(revisions&&revisions.length>50)throw Error('Cronologia troppo lunga');
  return {id:p.id,spec:validateSpec(p.spec),...(revisions?{revisions}:{})};
 });
}
export function createRepository(store:Storage){
 let queue:Promise<unknown>=Promise.resolve();
 async function load():Promise<{projects:Project[];recovered:boolean}>{
  const main=await store.getItem(PRIMARY),backup=await store.getItem(BACKUP);
  if(main!==null){try{return {projects:decode(main),recovered:false};}catch{/* recover below */}}
  if(backup!==null){try{return {projects:decode(backup),recovered:true};}catch{/* preserve damaged data */}}
  if(main===null&&backup===null)return {projects:[],recovered:false};
  throw Error('Salvataggio danneggiato: recupero necessario. I dati originali sono conservati.');
 }
 function save(projects:Project[]):Promise<void>{
  const run=queue.then(async()=>{
   const current=await load();
   const next=JSON.stringify({version:1,projects});decode(next);
   if(!current.recovered)await store.setItem(BACKUP,JSON.stringify({version:1,projects:current.projects}));
   await store.setItem(PRIMARY,next);
   if(await store.getItem(PRIMARY)!==next)throw Error('Scrittura non verificata: riprovare il salvataggio.');
  });queue=run.catch(()=>{});return run;
 }
 return {load,save};
}
