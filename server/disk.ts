import {mkdir,open,readFile,rename} from 'node:fs/promises';
import {join} from 'node:path';
import {randomUUID} from 'node:crypto';
import type {Storage} from '../src/core/storage.ts';
export function diskStorage(dir:string):Storage {return {async getItem(k){try{return await readFile(join(dir,encodeURIComponent(k)+'.json'),'utf8');}catch(e:any){if(e.code==='ENOENT')return null;throw e;}},async setItem(k,v){await mkdir(dir,{recursive:true,mode:0o700});const target=join(dir,encodeURIComponent(k)+'.json'),temp=target+'.'+randomUUID()+'.tmp';const f=await open(temp,'wx',0o600);try{await f.writeFile(v);await f.sync();}finally{await f.close();}await rename(temp,target);}};}
