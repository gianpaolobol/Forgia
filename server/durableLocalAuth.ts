import {closeSync,constants,fstatSync,lstatSync,openSync,readFileSync} from 'node:fs';
import {join} from 'node:path';
import {pilotGrant,pilotGrantActive,validatePilotAccounts} from './pilot.ts';

function entry(path:string) {
 try{return lstatSync(path);}catch(error){if((error as NodeJS.ErrnoException).code==='ENOENT')return;throw error;}
}
// Local-only operator-managed snapshot. Never persist bearer tokens in jobs.
// The marker prevents accidentally restarting the same DB in trusted mode.
export function prepareDurableLocalAuth(directory:string,enabled:boolean) {
 const marker=join(directory,'auth-required'),accounts=join(directory,'accounts.json');
 const saved=entry(marker),accountEntry=entry(accounts);
 if(!enabled){if(saved||accountEntry)throw Error('Archivio autorizzazioni presente: mantenere opt-in o riconciliare offline.');return;}
 const privateFile=(s:ReturnType<typeof lstatSync>)=>s.isFile()&&(process.platform==='win32'||!(s.mode&0o077));
 const dir=lstatSync(directory);
 if(!dir.isDirectory()||(process.platform!=='win32'&&(dir.mode&0o077)))throw Error('Directory autorizzazioni non privata.');
 function read():unknown {
  const s=entry(accounts);
  if(!s||!privateFile(s))throw Error('Archivio autorizzazioni non disponibile.');
  const fd=openSync(accounts,constants.O_RDONLY|(process.platform==='win32'?0:constants.O_NOFOLLOW|constants.O_NONBLOCK));
  try{
   const st=fstatSync(fd);
   if(!privateFile(st)||st.size<2||st.size>65536)throw Error('Archivio autorizzazioni non valido.');
   const data=readFileSync(fd);
   if(data.length>65536)throw Error('Archivio autorizzazioni non valido.');
   return JSON.parse(data.toString('utf8'));
  }finally{closeSync(fd);}
 }
 validatePilotAccounts(read());
 if(saved&&!privateFile(saved))throw Error('Marker autorizzazioni non valido.');
 if(!saved)closeSync(openSync(marker,'wx',0o600));
 return {
  identity(header:string|undefined){return pilotGrant(header,read());},
  async active(session:string,grant:string){try{return pilotGrantActive(session,grant,read());}catch{return false;}},
 };
}
