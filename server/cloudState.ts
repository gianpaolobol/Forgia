import {lstatSync,openSync,closeSync,fsyncSync} from 'node:fs';
import {join} from 'node:path';
import {openQuotaLedger} from './quotaLedger.ts';
import {openCloudCache} from './cloudCache.ts';

function privatePath(path:string,directory=false,optional=false) {
  try {
    const stat=lstatSync(path);
    if (!(directory?stat.isDirectory():stat.isFile()) ||
        (process.platform!=='win32' && (stat.mode & 0o077))) throw Error('Archivio quota/cache non privato.');
    return true;
  } catch(error) {
    if (optional && (error as NodeJS.ErrnoException).code==='ENOENT') return false;
    throw error;
  }
}

// Independent marker: losing only cloud.sqlite must not allow downgrade or
// reimport of stale JSON counters. Check dangling links and orphan sidecars too.
export function assertCloudStateMode(directory:string,enabled:boolean) {
  if (!enabled && ['cloud-required','cloud.sqlite','cloud.sqlite-wal','cloud.sqlite-shm'].some(name=>privatePath(join(directory,name),false,true))) {
    throw Error('Archivio quota/cache presente: mantenere opt-in o ripristinare offline.');
  }
}

function persistMarker(directory:string,path:string) {
  const fd=openSync(path,'wx',0o600);
  try {fsyncSync(fd);} finally {closeSync(fd);}
  // Windows directory fsync/ACL durability requires native acceptance.
  if (process.platform!=='win32') {
    const dir=openSync(directory,'r');
    try {fsyncSync(dir);} finally {closeSync(dir);}
  }
}

// Offline bootstrap after local jobs cutover. Never infer a fresh install from
// missing legacy data, recreate a missing DB at restart, or overwrite a DB.
// The operator must stop every legacy writer before initialization.
export function prepareCloudState(directory:string,initialize:boolean,snapshot:string|null) {
  privatePath(directory,true);
  privatePath(join(directory,'jobs.sqlite'));
  const path=join(directory,'cloud.sqlite'),marker=join(directory,'cloud-required');
  const marked=privatePath(marker,false,true);
  const wal=privatePath(path+'-wal',false,true);
  const shm=privatePath(path+'-shm',false,true);
  let source:unknown;
  if (initialize) {
    if (marked) throw Object.assign(Error('Migrazione quota/cache già registrata: ripristino offline necessario.'),{code:'EEXIST'});
    if (wal||shm) throw Error('File quota/cache ausiliari presenti: ripristino offline necessario.');
    if (snapshot===null || Buffer.byteLength(snapshot)>16*1024*1024) throw Error('Snapshot quota storico necessario.');
    source=JSON.parse(snapshot);
    if (source===null) throw Error('Snapshot quota storico necessario.');
    closeSync(openSync(path,'wx',0o600));
  }
  privatePath(path);
  const quotaLedger=openQuotaLedger(path);
  try {
    if (initialize) quotaLedger.initialize(source);
    for (const provider of ['groq','openrouter','cloudflare']) quotaLedger.read(provider);
    const cloudCache=openCloudCache(path);
    try {
      // Also adopt a valid pre-marker database at its first protected restart.
      // Never allow inference before this independent marker is persisted.
      if (!marked) persistMarker(directory,marker);
    } catch(error) {cloudCache.close();throw error;}
    return {quotaLedger,cloudCache,close(){try {cloudCache.close();} finally {quotaLedger.close();}}};
  } catch(error) {
    quotaLedger.close();
    // Leave any incomplete DB in place for explicit offline recovery.
    throw error;
  }
}
