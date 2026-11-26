import {lstatSync,openSync,closeSync} from 'node:fs';
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

// Offline bootstrap after local jobs cutover. Never infer a fresh install from
// missing legacy data, recreate a missing DB at restart, or overwrite a DB.
// The operator must stop every legacy writer before initialization.
export function prepareCloudState(directory:string,initialize:boolean,snapshot:string|null) {
  privatePath(directory,true);
  privatePath(join(directory,'jobs.sqlite'));
  const path=join(directory,'cloud.sqlite');
  privatePath(path+'-wal',false,true);
  privatePath(path+'-shm',false,true);
  let source:unknown;
  if (initialize) {
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
    return {quotaLedger,cloudCache,close(){try {cloudCache.close();} finally {quotaLedger.close();}}};
  } catch(error) {
    quotaLedger.close();
    // Leave any incomplete DB in place for explicit offline recovery.
    throw error;
  }
}
