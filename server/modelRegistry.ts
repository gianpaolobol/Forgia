// Configuration only: profiles cannot introduce endpoints, credentials or quota domains.
export const providerIds = Object.freeze(['local','llamacpp','groq','openrouter','cloudflare'] as const);
export type ProviderId = typeof providerIds[number];
export const knownProvider = (id:string): id is ProviderId => providerIds.some(value => value===id);
export const localProvider = (id:string) => id==='local'||id==='llamacpp';
export type ModelConfig = {id:string;model:string;prefix:string};
export type ResolvedModel<T extends ModelConfig> = T & {profile?:string;fitRaw?:string};
const record = (value:unknown): value is Record<string,unknown> => value!==null && typeof value==='object' && !Array.isArray(value);
const exact = (value:Record<string,unknown>,keys:readonly string[]) => Object.keys(value).every(key=>keys.includes(key));
const invalid = () => Error('Registro modelli AI non valido.');
const profileId = (value:unknown): value is string => typeof value==='string' && /^[a-z][a-z0-9_-]{0,39}$/.test(value);
export function validateModel(id:string,model:unknown): asserts model is string {
 if(!knownProvider(id)||typeof model!=='string'||!model||model.length>150||/[\s\x00-\x1f\x7f]/.test(model))throw invalid();
 if(id==='local'&&/cloud|https?:|\//i.test(model))throw invalid();
 if(id==='llamacpp'&&!/^[a-zA-Z0-9_.:-]+$/.test(model))throw invalid();
 if(id==='openrouter'&&!/^[a-zA-Z0-9._-]+\/[a-zA-Z0-9._-]+:free$/.test(model))throw invalid();
 if(id==='cloudflare'&&model!=='@cf/meta/llama-3.1-8b-instruct')throw invalid();
}
function fitRaw(value:unknown):string|undefined {
 if(value===undefined)return undefined;
 if(!record(value))throw invalid();
 for(const [key,n] of Object.entries(value)) {
  if(!['draft','revision','catalog','tracker','community','maxInputBytes'].includes(key)||typeof n!=='number'||!Number.isInteger(n)||n<1||n>(key==='maxInputBytes'?32000:10))throw invalid();
 }
 return JSON.stringify(value);
}
export function resolveModelRegistry<T extends ModelConfig>(legacy:readonly T[],raw?:string):ResolvedModel<T>[] {
 if(new Set(legacy.map(c=>c.id)).size!==legacy.length||legacy.some(c=>!knownProvider(c.id)))throw invalid();
 if(raw===undefined)return legacy.map(c=>({...c}));
 if(raw.length>32768)throw invalid();
 let value:unknown;
 try {value=JSON.parse(raw);}catch{throw invalid();}
 if(!record(value)||Object.keys(value).some(id=>!legacy.some(c=>c.id===id)))throw invalid();
 return legacy.map(config=>{
  if(!Object.hasOwn(value,config.id))return {...config};
  const group=value[config.id];
  if(!record(group)||!exact(group,['active','profiles'])||!profileId(group.active)||!Array.isArray(group.profiles)||group.profiles.length<1||group.profiles.length>32)throw invalid();
  const names=new Set<string>();
  const profiles=group.profiles.map((p:unknown)=>{
   if(!record(p)||!exact(p,['id','model','fit'])||!profileId(p.id)||names.has(p.id))throw invalid();
   names.add(p.id);
   validateModel(config.id,p.model);
   return {id:p.id,model:p.model,fitRaw:fitRaw(p.fit)};
  });
  const active=profiles.find(p=>p.id===group.active);
  if(!active)throw invalid();
  // Deliberately whitelist overrides; quota identity and credentials remain legacy-owned.
  return {...config,model:active.model,profile:active.id,fitRaw:active.fitRaw};
 });
}
