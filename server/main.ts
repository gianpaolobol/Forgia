import {createServer} from 'node:http';
import {resolve} from 'node:path';
import {createProvider} from './providers.ts';
import {createGateway} from './gateway.ts';
import {diskStorage} from './disk.ts';
const gateway=createGateway(diskStorage(resolve('.data')));
const configs=[{id:'local',model:process.env.OLLAMA_MODEL??''},{id:'groq',model:process.env.GROQ_MODEL??'',apiKey:process.env.GROQ_API_KEY,freePlanConfirmed:process.env.GROQ_FREE_PLAN_CONFIRMED==='true'},{id:'openrouter',model:process.env.OPENROUTER_MODEL??'',apiKey:process.env.OPENROUTER_API_KEY}];
const allowed=new Set(['http://localhost:8081','http://127.0.0.1:8081']);
createServer(async(req,res)=>{
 const origin=req.headers.origin;
 if((origin&&!allowed.has(origin))||!['127.0.0.1:8787','localhost:8787'].includes(req.headers.host??'')){res.writeHead(403);res.end();return;}
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
