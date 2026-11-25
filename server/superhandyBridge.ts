import {createHash,randomUUID} from 'node:crypto';
import {closeSync,constants,fstatSync,fsyncSync,lstatSync,mkdirSync,openSync,readFileSync,writeFileSync} from 'node:fs';
import {join} from 'node:path';
import type {openSuperhandyLedger} from './superhandyLedger.ts';
type Ledger=Pick<ReturnType<typeof openSuperhandyLedger>,'claim'|'dispatch'|'recordReceipt'|'submit'>;
type LocalProvider='local'|'llamacpp';
const origin='http://127.0.0.1:8787';
const hash=(text:string)=>createHash('sha256').update(text).digest('hex');
const uuid=/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i;
const record=(x:unknown):x is Record<string,unknown>=>!!x&&typeof x==='object'&&!Array.isArray(x);
function requirePrivateDirectory(path:string){
 const s=lstatSync(path);
 if(!s.isDirectory()||(process.platform!=='win32'&&(s.mode&0o077)))throw Error('Directory artefatti non privata.');
}
function persist(dir:string,name:string,value:unknown){
 const body=JSON.stringify(value);
 if(Buffer.byteLength(body)>4*1024*1024)throw Error('Artefatto troppo grande.');
 const fd=openSync(join(dir,name),'wx',0o600);
 try{writeFileSync(fd,body,'utf8');fsyncSync(fd);}finally{closeSync(fd);}
 if(process.platform!=='win32'){const d=openSync(dir,'r');try{fsyncSync(d);}finally{closeSync(d);}}
 return hash(body);
}
async function json(response:Response,limit=4*1024*1024):Promise<unknown>{
 if(!response.ok||!response.body)throw Error('Gateway locale non disponibile o richiesta non riuscita.');
 const reader=response.body.getReader(),chunks:Uint8Array[]=[];let size=0;
 try{for(;;){const part=await reader.read();if(part.done)break;size+=part.value.byteLength;if(size>limit)throw Error('Risposta gateway troppo grande.');chunks.push(part.value);}}
 finally{await reader.cancel().catch(()=>{});reader.releaseLock();}
 return JSON.parse(Buffer.concat(chunks).toString('utf8'));
}
// Trusted LOCAL operator only. Explicit task selection; this generates an app
// specification, never executes generated code or represents an authenticated AI.
export async function runLocalSpec(ledger:Ledger,options:{
 actor:string;taskId:string;provider:LocalProvider;artifactDir:string;
 verifySpec:(value:unknown)=>unknown;transport?:typeof fetch;pollMs?:number;timeoutMs?:number;
}){
 if(!['local','llamacpp'].includes(options.provider))throw Error('Solo provider locale esplicito.');
 const timeout=options.timeoutMs??120000,poll=options.pollMs??500;
 if(!Number.isSafeInteger(timeout)||timeout<1||timeout>120000||!Number.isSafeInteger(poll)||poll<0||poll>5000)throw Error('Tempi bridge non validi.');
 const transport=options.transport??fetch,signal=AbortSignal.timeout(timeout);
 const request=(path:string,init:RequestInit={})=>transport(origin+path,{...init,signal,redirect:'error'});
 const meta=await json(await request('/providers'),65536);
 if(!record(meta)||meta.mode!=='free-only'||meta.localDevelopmentOnly!==true||meta.durableLocal!==true||!Array.isArray(meta.providers))throw Error('Gateway SQLite loopback richiesto.');
 const provider=meta.providers.find((p:unknown)=>record(p)&&p.id===options.provider&&p.configured===true);
 if(!record(provider)||typeof provider.model!=='string'||!provider.model)throw Error('Provider locale non configurato.');
 requirePrivateDirectory(options.artifactDir);
 const dir=options.artifactDir;
 signal.throwIfAborted();
 const work=ledger.claim(options.actor,300000,options.taskId);
 if(!work)return {status:'idle' as const};
 const {lease,task,baselineSha}=work;
 const tag=baselineSha+'-'+task.id+'-'+lease.fence;
 const session=randomUUID(),requestKey='sh:'+tag;
 // Persist intent before the fenced dispatch. A failed or ambiguous POST is
 // never repeated by this bridge; the lease eventually becomes uncertain.
 const intentEvidence=persist(dir,tag+'.intent.json',{baselineSha,task:task.id,fence:lease.fence,actor:lease.actor,session,requestKey,provider:options.provider,model:provider.model});
 signal.throwIfAborted();
 ledger.dispatch(lease,intentEvidence);
 const receipt=await json(await request('/jobs',{method:'POST',headers:{'content-type':'application/json','idempotency-key':requestKey},body:JSON.stringify({session,provider:options.provider,idea:task.criterion,cloudConsent:false,kind:'catalog',phase:'draft'})}),65536);
 if(!record(receipt)||typeof receipt.id!=='string'||!uuid.test(receipt.id))throw Error('Ricevuta gateway non valida: non ripetere.');
 const jobId=receipt.id;
 const receiptEvidence=persist(dir,tag+'.receipt.json',{jobId,session,requestKey});
 ledger.recordReceipt(lease,receiptEvidence);
 for(;;){
  signal.throwIfAborted();
  const job=await json(await request('/jobs/'+jobId));
  if(!record(job))throw Error('Stato gateway non valido.');
  if(job.status==='done'){
   const result=job.result;
   if(!record(result)||!record(result.routing)||result.routing.provider!==options.provider||result.routing.model!==provider.model)throw Error('Risultato non corrispondente al provider autorizzato.');
   const spec=options.verifySpec(result.spec);
   signal.throwIfAborted();
   const evidence=persist(dir,tag+'.result.json',{baselineSha,task:task.id,fence:lease.fence,jobId,provider:options.provider,model:provider.model,spec});
   ledger.submit(lease,evidence);
   return {status:'submitted' as const,jobId,evidence};
  }
  if(job.status==='failed')throw Error('Lavoro gateway fallito: verificare la ricevuta, non ripetere.');
  if(job.status!=='queued'&&job.status!=='running')throw Error('Stato gateway sconosciuto.');
  if(typeof job.nextEligibleAt==='number'&&job.nextEligibleAt>Date.now())return {status:'deferred' as const,jobId,nextEligibleAt:job.nextEligibleAt};
  await new Promise<void>(resolve=>setTimeout(resolve,poll));
 }
}
export function prepareSuperhandyArtifacts(root:string,archive:string){
 requirePrivateDirectory(root);
 if(!/^[a-z][a-z0-9_-]{0,63}$/.test(archive))throw Error('Archivio non valido.');
 const dir=join(root,archive+'-artifacts');
 try{mkdirSync(dir,{mode:0o700});}catch(e){if((e as NodeJS.ErrnoException).code!=='EEXIST')throw e;}
 requirePrivateDirectory(dir);return dir;
}

function readPrivate(dir:string,name:string){
 const fd=openSync(join(dir,name),constants.O_RDONLY|(process.platform==='win32'?0:constants.O_NOFOLLOW|constants.O_NONBLOCK));
 try{
  const s=fstatSync(fd);
  if(!s.isFile()||(process.platform!=='win32'&&(s.mode&0o077))||s.size>4*1024*1024)throw Error('Artefatto non valido o non privato.');
  const body=readFileSync(fd,'utf8');
  if(Buffer.byteLength(body)>4*1024*1024)throw Error('Artefatto troppo grande.');
  return body;
 }finally{closeSync(fd);}
}
function persistResult(dir:string,name:string,value:unknown){
 try{return persist(dir,name,value);}
 catch(e){
  if((e as NodeJS.ErrnoException).code!=='EEXIST')throw e;
  const body=readPrivate(dir,name);
  if(body!==JSON.stringify(value))throw Error('Artefatto preesistente non corrispondente.');
  return hash(body);
 }
}
// Resume only by receipt, never by re-submitting the prompt. An expired
// Superhandy lease can be reconciled, but the reviewer still must accept.
export async function resumeLocalSpec(ledger:Pick<ReturnType<typeof openSuperhandyLedger>,'inspect'|'reconcile'>,options:{
 actor:string;taskId:string;artifactDir:string;verifySpec:(value:unknown)=>unknown;transport?:typeof fetch;
}){
 requirePrivateDirectory(options.artifactDir);
 const state=ledger.inspect(),row=state.tasks.find(r=>r.id===options.taskId);
 if(!state.approval||!row||!['dispatched','uncertain'].includes(String(row.status))||typeof row.fence!=='number'||!Number.isSafeInteger(row.fence)||row.fence<1)throw Error('Task non riconciliabile.');
 const event=state.events.findLast(e=>e.task===options.taskId&&e.action==='dispatch');
 if(event?.actor!==options.actor||!state.plan.executors.includes(options.actor))throw Error('Attore non corrispondente al dispatch.');
 const tag=state.baselineSha+'-'+options.taskId+'-'+row.fence,dir=options.artifactDir;
 const receiptEvent=state.events.findLast(e=>e.task===options.taskId&&e.action==='receipt');
 const intentBody=readPrivate(dir,tag+'.intent.json'),receiptBody=readPrivate(dir,tag+'.receipt.json');
 if(!event||!receiptEvent||Number(receiptEvent.seq)<=Number(event.seq)||receiptEvent.actor!==options.actor||event.evidence!==hash(intentBody)||receiptEvent.evidence!==hash(receiptBody))throw Error('Hash di intento o ricevuta non corrispondente al registro.');
 const intent:unknown=JSON.parse(intentBody);
 const receipt:unknown=JSON.parse(receiptBody);
 if(!record(intent)||intent.baselineSha!==state.baselineSha||intent.task!==options.taskId||intent.fence!==row.fence||intent.actor!==options.actor||typeof intent.session!=='string'||!uuid.test(intent.session)||intent.requestKey!=='sh:'+tag||!['local','llamacpp'].includes(String(intent.provider))||typeof intent.model!=='string'||!intent.model)throw Error('Intento non corrispondente.');
 if(!record(receipt)||receipt.session!==intent.session||receipt.requestKey!==intent.requestKey||typeof receipt.jobId!=='string'||!uuid.test(receipt.jobId))throw Error('Ricevuta non corrispondente.');
 const jobId=receipt.jobId,transport=options.transport??fetch,signal=AbortSignal.timeout(15000);
 const request=(path:string)=>transport(origin+path,{method:'GET',signal,redirect:'error'});
 const meta=await json(await request('/providers'),65536);
 if(!record(meta)||meta.mode!=='free-only'||meta.localDevelopmentOnly!==true||meta.durableLocal!==true)throw Error('Gateway SQLite loopback richiesto.');
 const job=await json(await request('/jobs/'+jobId));
 if(!record(job))throw Error('Stato gateway non valido.');
 if(job.status==='queued'||job.status==='running')return {status:'pending' as const,jobId,...(typeof job.nextEligibleAt==='number'?{nextEligibleAt:job.nextEligibleAt}:{})};
 if(job.status!=='done')throw Error('Lavoro gateway non concluso con successo: non ripetere.');
 const result=job.result;
 if(!record(result)||!record(result.routing)||result.routing.provider!==intent.provider||result.routing.model!==intent.model)throw Error('Risultato non corrispondente al dispatch.');
 const spec=options.verifySpec(result.spec);signal.throwIfAborted();
 const evidence=persistResult(dir,tag+'.result.json',{baselineSha:state.baselineSha,task:options.taskId,fence:row.fence,jobId,provider:intent.provider,model:intent.model,spec});
 ledger.reconcile({id:options.taskId,actor:options.actor,fence:row.fence},evidence);
 return {status:'submitted' as const,jobId,evidence};
}
