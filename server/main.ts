import {createServer} from 'node:http';
import {resolve} from 'node:path';
import {createProvider} from './providers.ts';
import {createGateway} from './gateway.ts';
import {diskStorage} from './disk.ts';
import {buildaError,createBuildaWorker} from './builda.ts';
const storage=diskStorage(resolve('.data'));
const gateway=createGateway(storage);
const buildaPort=process.env.BUILDA_LOOPBACK_PORT;
const builda=buildaPort?createBuildaWorker(storage,/^[0-9]{1,5}$/.test(buildaPort)?Number(buildaPort):NaN):null;
const configs=[{id:'local',model:process.env.OLLAMA_MODEL??''},{id:'groq',model:process.env.GROQ_MODEL??'',apiKey:process.env.GROQ_API_KEY,freePlanConfirmed:process.env.GROQ_FREE_PLAN_CONFIRMED==='true'},{id:'openrouter',model:process.env.OPENROUTER_MODEL??'',apiKey:process.env.OPENROUTER_API_KEY}];
const allowed=new Set(['http://localhost:8081','http://127.0.0.1:8081']);
createServer(async(req,res)=>{
 const origin=req.headers.origin;
 if((origin&&!allowed.has(origin))||!['127.0.0.1:8787','localhost:8787'].includes(req.headers.host??'')){res.writeHead(403);res.end();return;}
 if(req.url==='/builda/v1/experiments'){
  res.setHeader('Cache-Control','no-store');
  res.setHeader('Content-Type','application/json');
  res.setHeader('X-Content-Type-Options','nosniff');
  try{
   if(origin!==undefined)throw buildaError(403,'Client locale richiesto.');
   if(!builda||req.method!=='POST')throw buildaError(404,'Percorso non disponibile.');
   if(req.headers['content-type']?.split(';')[0].trim().toLowerCase()!=='application/json'){
    throw buildaError(415,'JSON richiesto.');
   }
   let size=0;
   const chunks:Buffer[]=[];
   for await(const chunk of req.iterator({destroyOnReturn:false})){
    size+=chunk.length;
    if(size>4096)throw buildaError(413,'Richiesta troppo grande.');
    chunks.push(chunk);
   }
   const body:unknown=JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(Buffer.concat(chunks)));
   res.end(JSON.stringify(await builda.runJob(body)));
  }catch(error){
   const status=error instanceof Error&&'status' in error&&typeof error.status==='number'?
    error.status:error instanceof SyntaxError||error instanceof TypeError?400:500;
   res.writeHead(status,{'Connection':'close'});
   res.end(JSON.stringify({error:status===400?'Richiesta Builda non valida.':
    status===500?'Registro job Builda non disponibile.':(error as Error).message}));
  }
  return;
 }
 if(origin)res.setHeader('Access-Control-Allow-Origin',origin);
 res.setHeader('Vary','Origin');res.setHeader('Cache-Control','no-store');res.setHeader('Content-Type','application/json');res.setHeader('X-Content-Type-Options','nosniff');
 if(req.method==='OPTIONS'){res.setHeader('Access-Control-Allow-Methods','GET, POST');res.setHeader('Access-Control-Allow-Headers','Content-Type');res.writeHead(204);res.end();return;}
 try{
  if(req.method==='GET'&&req.url==='/providers'){
   const providers=configs.filter(c=>c.model&&(c.id==='local'||c.apiKey)).map(c=>{try{createProvider(c);return {id:c.id,model:c.model,configured:true};}catch{return {id:c.id,model:c.model,configured:false};}});
   res.end(JSON.stringify({mode:'free-only',providers,localDevelopmentOnly:true}));return;
  }
  if(req.method!=='POST'||req.url!=='/plan'){res.writeHead(404);res.end(JSON.stringify({error:'Percorso non disponibile.'}));return;}
  if(!req.headers['content-type']?.startsWith('application/json')){res.writeHead(415);res.end(JSON.stringify({error:'JSON richiesto.'}));return;}
  let raw='';for await(const chunk of req){raw+=chunk.toString();if(Buffer.byteLength(raw)>20000)throw Object.assign(Error('Richiesta troppo grande.'),{status:413});}
  const body=JSON.parse(raw),config=configs.find(c=>c.id===body.provider);
  if(!config)throw Error('Fornitore non configurato.');
  const result=await gateway.plan(body.idea,createProvider(config),body.cloudConsent===true);res.end(JSON.stringify(result));
 }catch(e:any){res.writeHead(e.status===429?429:e.status===413?413:400);res.end(JSON.stringify({error:e instanceof SyntaxError?'Risposta o richiesta JSON non valida.':e.message??'Operazione non riuscita.'}));}
}).listen(8787,'127.0.0.1',()=>console.log('Gateway gratuito di sviluppo: http://127.0.0.1:8787. Nessun provider abilitato senza configurazione.'));
