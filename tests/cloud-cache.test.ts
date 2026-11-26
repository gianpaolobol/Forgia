import {test,type TestContext} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {DatabaseSync} from 'node:sqlite';
import {cloudCacheKey,openCloudCache} from '../server/cloudCache.ts';
const key=(prompt='idea',scope='a',model='m',provider='groq')=>cloudCacheKey(provider,model,prompt,scope);
function fixture(t:TestContext){const dir=mkdtempSync(join(tmpdir(),'forgia-cache-'));t.after(()=>rmSync(dir,{recursive:true,force:true}));return join(dir,'cache.db');}
test('C1 persistence and namespace isolation across independent connections',t=>{
 const path=fixture(t),a=openCloudCache(path),b=openCloudCache(path);
 try {a.write(key(),{ok:true});assert.deepEqual(b.read(key()),{ok:true});
 for(const k of [key('other'),key('idea','b'),key('idea','a','other'),key('idea','a','m','openrouter'),cloudCacheKey('groq','m','idea')])assert.equal(b.read(k),undefined);
 }finally{a.close();b.close();}
 const c=openCloudCache(path);try{assert.deepEqual(c.read(key()),{ok:true});}finally{c.close();}
});
test('C2 TTL boundary and transactional capacity',t=>{
 const path=fixture(t);let now=100_000_000;const a=openCloudCache(path,()=>now),b=openCloudCache(path,()=>now);
 try {a.write(key(),1);now+=86_399_999;assert.equal(b.read(key()),1);now++;assert.equal(b.read(key()),undefined);
 for(let i=0;i<101;i++){now++;(i%2?a:b).write(key(String(i)),i);}
 assert.equal(a.read(key('0')),undefined);assert.equal(a.read(key('100')),100);
 const db=new DatabaseSync(path);try{assert.equal(db.prepare('SELECT count(*) AS n FROM forgia_cloud_cache_v1').get()?.n,100);}finally{db.close();}
 }finally{a.close();b.close();}
});
test('C3 invalid key, oversized values, corrupt data and clock rollback fail closed',t=>{
 const path=fixture(t);let now=1000;const a=openCloudCache(path,()=>now);
 try {assert.throws(()=>a.write('invalid',1));assert.throws(()=>a.write(key(),'x'.repeat(1024*1024)));a.write(key(),1);now--;assert.throws(()=>a.read(key()));now++;
 const db=new DatabaseSync(path);try{db.prepare('UPDATE forgia_cloud_cache_v1 SET value=?').run('{');}finally{db.close();}assert.throws(()=>a.read(key()));
 }finally{a.close();}
});
