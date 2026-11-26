import {lstatSync,mkdirSync,openSync,closeSync,readFileSync,statSync} from 'node:fs';
import {resolve,join} from 'node:path';
import {openSuperhandyLedger,validateBaseline} from '../server/superhandyLedger.ts';
import {runLocalSpec,resumeLocalSpec,prepareSuperhandyArtifacts} from '../server/superhandyBridge.ts';
import {validateSpec} from '../src/core/spec.ts';
import {localSpecAuthorization} from '../server/superhandyGrant.ts';
const [command,archive,...args]=process.argv.slice(2);
function privatePath(path:string,directory=false,optional=false){
 try{const s=lstatSync(path);if(!(directory?s.isDirectory():s.isFile())||(process.platform!=='win32'&&(s.mode&0o077)))throw Error('Archivio non privato.');}
 catch(e){if(!optional||(e as NodeJS.ErrnoException).code!=='ENOENT')throw e;}
}
async function main(){
 if(!archive||!/^[a-z][a-z0-9_-]{0,63}$/.test(archive)||!['init','approve','claim','dispatch','heartbeat','handoff','submit','review','inspect','run-local-spec','resume-local-spec','run-granted-local-spec','resume-granted-local-spec'].includes(command))throw Error('Comando o archivio non valido.');
 const counts:Record<string,number>={init:1,approve:3,claim:1,dispatch:1,heartbeat:2,handoff:2,submit:2,review:5,inspect:0,'run-local-spec':3,'resume-local-spec':2,'run-granted-local-spec':4,'resume-granted-local-spec':3};
 if(args.length!==counts[command])throw Error('Numero argomenti non valido.');
 const input=command==='init'?(statSync(args[0]).size>1024*1024?(()=>{throw Error('Piano troppo grande.');})():validateBaseline(JSON.parse(readFileSync(args[0],'utf8')))):undefined;
 const root=resolve(process.env.FORGIA_DATA_DIR||'.data');privatePath(root,true);
 const dir=join(root,'superhandy'),path=join(dir,archive+'.sqlite');
 if(command==='init'){try{mkdirSync(dir,{mode:0o700});}catch(e){if((e as NodeJS.ErrnoException).code!=='EEXIST')throw e;}}
 privatePath(dir,true);privatePath(path+'-wal',false,true);privatePath(path+'-shm',false,true);
 if(command==='init')closeSync(openSync(path,'wx',0o600));
 privatePath(path);const ledger=openSuperhandyLedger(path,command==='init');
 try{switch(command){
  case 'init':return ledger.install(input);
  case 'approve':return ledger.approve(args[0],args[1],args[2]);
  case 'claim':return ledger.claim(args[0]);
  case 'heartbeat':return ledger.heartbeat(JSON.parse(args[0]),Number(args[1]));
  case 'dispatch':return ledger.dispatch(JSON.parse(args[0]));
  case 'handoff':return ledger.handoff(JSON.parse(args[0]),args[1]);
  case 'submit':return ledger.submit(JSON.parse(args[0]),args[1]);
  case 'review':return ledger.review(args[0],args[1],args[2],args[3] as 'accept'|'reject',args[4]);
  case 'inspect':return ledger.inspect();
  case 'resume-granted-local-spec':
  case 'resume-local-spec':return await resumeLocalSpec(ledger,{actor:args[0],taskId:args[1],artifactDir:prepareSuperhandyArtifacts(dir,archive),verifySpec:validateSpec,...(command==='resume-granted-local-spec'?{authorization:localSpecAuthorization(resolve(args[2]))}:{})});
  case 'run-granted-local-spec':
  case 'run-local-spec':{
   const [actor,taskId,provider]=args;
   if(provider!=='local'&&provider!=='llamacpp')throw Error('Provider locale esplicito richiesto.');
   return await runLocalSpec(ledger,{actor,taskId,provider,artifactDir:prepareSuperhandyArtifacts(dir,archive),verifySpec:validateSpec,...(command==='run-granted-local-spec'?{authorization:localSpecAuthorization(resolve(args[3]))}:{})});
  }
 }}finally{ledger.close();}
}
try{const result=await main();console.log(JSON.stringify(result===undefined?{ok:true}:result,null,2));}catch(e){console.error(e instanceof Error?e.message:'Operazione non riuscita.');process.exitCode=1;}
