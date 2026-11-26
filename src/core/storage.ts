import { validateSpec, type Project } from './spec.ts';
export interface Storage {getItem(key:string):Promise<string|null>;setItem(key:string,value:string):Promise<void>}
const PRIMARY='forgia.projects.v1';
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
export function createRepository(store: Storage) {
  return createBackedRepository(store, PRIMARY, decode, projects => JSON.stringify({version: 1, projects}));
}

export function createBackedRepository<T>(
  store: Storage,
  primary: string,
  decode: (raw: string) => T[],
  encode: (projects: T[]) => string,
  loadInitial: () => Promise<T[]> = async () => [],
) {
  const backupKey = primary + '.backup';
  let queue: Promise<void> = Promise.resolve();

  async function load(): Promise<{projects: T[]; recovered: boolean}> {
    const main = await store.getItem(primary);
    if (main !== null) {
      try { return {projects: decode(main), recovered: false}; }
      catch { /* Try the backup. */ }
    }
    const backup = await store.getItem(backupKey);
    if (backup !== null) {
      try { return {projects: decode(backup), recovered: true}; }
      catch { /* Preserve both originals. */ }
    }
    if (main === null && backup === null) return {projects: await loadInitial(), recovered: false};
    throw Error('Salvataggio danneggiato: recupero necessario. I dati originali sono conservati.');
  }

  function save(projects: T[]): Promise<void> {
    const run = queue.then(async () => {
      const next = encode(projects);
      decode(next);
      const current = await load();
      if (!current.recovered) await store.setItem(backupKey, encode(current.projects));
      await store.setItem(primary, next);
      if (await store.getItem(primary) !== next) throw Error('Scrittura non verificata: riprovare il salvataggio.');
    });
    queue = run.catch(() => {});
    return run;
  }

  return {load, save};
}
