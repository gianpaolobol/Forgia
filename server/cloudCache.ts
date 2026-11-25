import {createHash} from 'node:crypto';
import {DatabaseSync} from 'node:sqlite';
const ttl=86_400_000, capacity=100, maxBytes=1024*1024;
const invalid=()=>Error('Cache cloud non valida.');
export function cloudCacheKey(provider:string,model:string,prompt:string,scope?:string) {
 if (!['groq','openrouter','cloudflare'].includes(provider)||!model||!prompt||scope==='') throw invalid();
 return createHash('sha256').update(JSON.stringify(['forgia-cloud-v1',scope??null,provider,model,prompt])).digest('hex');
}
export function openCloudCache(path:string,clock:()=>number=Date.now) {
 const db=new DatabaseSync(path);
 try {db.exec(`PRAGMA busy_timeout=5000; PRAGMA journal_mode=WAL; PRAGMA synchronous=FULL;
 CREATE TABLE IF NOT EXISTS forgia_cloud_cache_v1 (key TEXT PRIMARY KEY, created_at INTEGER NOT NULL, value TEXT NOT NULL);`);}
 catch(error){db.close();throw error;}
 function now(){const value=clock();if(!Number.isSafeInteger(value)||value<0||value>253402300799999)throw invalid();return value;}
 function keyCheck(key:string){if(!/^[a-f0-9]{64}$/.test(key))throw invalid();}
 function decode(value:unknown):unknown {if(typeof value!=='string'||Buffer.byteLength(value)>maxBytes)throw invalid();return JSON.parse(value);}
 return {
  read(key:string):unknown|undefined {
   keyCheck(key);const time=now();
   const row=db.prepare('SELECT created_at,value FROM forgia_cloud_cache_v1 WHERE key=?').get(key);
   if(!row)return undefined;
   if(!Number.isSafeInteger(row.created_at)||Number(row.created_at)<0||Number(row.created_at)>time)throw invalid();
   if(time-Number(row.created_at)>=ttl)return undefined;
   return decode(row.value);
  },
  write(key:string,value:unknown){
   keyCheck(key);const time=now(),raw=JSON.stringify(value);decode(raw);
   db.exec('BEGIN IMMEDIATE');
   try {
    db.prepare('DELETE FROM forgia_cloud_cache_v1 WHERE created_at<=?').run(time-ttl);
    db.prepare('INSERT INTO forgia_cloud_cache_v1(key,created_at,value) VALUES(?,?,?) ON CONFLICT(key) DO UPDATE SET created_at=excluded.created_at,value=excluded.value').run(key,time,raw);
    db.prepare('DELETE FROM forgia_cloud_cache_v1 WHERE key IN (SELECT key FROM forgia_cloud_cache_v1 ORDER BY created_at DESC,key DESC LIMIT -1 OFFSET ?)').run(capacity);
    db.exec('COMMIT');
   }catch(error){db.exec('ROLLBACK');throw error;}
  },
  close(){db.close();}
 };
}
