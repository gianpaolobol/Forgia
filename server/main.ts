import {createServer} from 'node:http';
import {resolve} from 'node:path';
import {createProvider} from './providers.ts';
import {createGateway} from './gateway.ts';
import {parseFit} from './routing.ts';
import {diskStorage} from './disk.ts';
import {createJobs} from './jobs.ts';
const storage = diskStorage(resolve('.data'));
const gateway = createGateway(storage);
const configs = [
 {id: 'local', prefix: 'OLLAMA', model: process.env.OLLAMA_MODEL ?? ''},
 {id: 'llamacpp', prefix: 'LLAMACPP', model: process.env.LLAMACPP_MODEL ?? ''},
 {id: 'cloudflare', prefix: 'CLOUDFLARE', model: process.env.CLOUDFLARE_MODEL ?? '', accountId: process.env.CLOUDFLARE_ACCOUNT_ID, apiKey: process.env.CLOUDFLARE_API_TOKEN, freePlanConfirmed: process.env.CLOUDFLARE_FREE_PLAN_CONFIRMED === 'true'},
 {id: 'groq', prefix: 'GROQ', model: process.env.GROQ_MODEL ?? '', apiKey: process.env.GROQ_API_KEY, freePlanConfirmed: process.env.GROQ_FREE_PLAN_CONFIRMED === 'true'},
 {id: 'openrouter', prefix: 'OPENROUTER', model: process.env.OPENROUTER_MODEL ?? '', apiKey: process.env.OPENROUTER_API_KEY},
];
function configuredProvider(config: typeof configs[number]) {
 return createProvider({...config, fit: parseFit(process.env[config.prefix + '_FIT'])});
}
const jobs = createJobs(storage, async ({idea, provider, consent, context}, backlog) => {
 if (provider === 'auto') {
  const providers = configs.flatMap(config => {
   try { return [configuredProvider(config)]; } catch { return []; }
  });
  return gateway.planAuto(idea, providers, consent, context, backlog);
 }
 const config = configs.find(c => c.id === provider);
 if (!config) throw Error('Motore non configurato.');
 const selected = configuredProvider(config);
 const result = await gateway.plan(idea, selected, consent);
 return {...result, routing: {provider: selected.id, model: selected.model, reason: 'Selezione manuale.', skipped: []}};
});
const allowed=new Set(['http://localhost:8081','http://127.0.0.1:8081']);
createServer(async(req,res)=>{
 const origin=req.headers.origin;
 if((origin&&!allowed.has(origin))||!['127.0.0.1:8787','localhost:8787'].includes(req.headers.host??'')){res.writeHead(403);res.end();return;}
 if(origin)res.setHeader('Access-Control-Allow-Origin',origin);
 res.setHeader('Vary','Origin');res.setHeader('Cache-Control','no-store');res.setHeader('Content-Type','application/json');res.setHeader('X-Content-Type-Options','nosniff');
 if(req.method==='OPTIONS'){res.setHeader('Access-Control-Allow-Methods','GET, POST');res.setHeader('Access-Control-Allow-Headers','Content-Type');res.writeHead(204);res.end();return;}
 try{
  if(req.method==='GET'&&req.url==='/providers'){
   const providers = configs.map(config => {
    try {
     configuredProvider(config);
     return {id: config.id, model: config.model, configured: true};
    } catch {
     return {id: config.id, model: config.model, configured: false};
    }
   });
   res.end(JSON.stringify({mode:'free-only',providers,localDevelopmentOnly:true}));return;
  }
  if (req.method === 'GET' && /^\/jobs\/[a-f0-9-]{36}$/.test(req.url ?? '')) {
   const job = await jobs.read(req.url!.slice(6));
   if (!job) res.writeHead(404);
   res.end(JSON.stringify(job ?? {error:'Lavoro non trovato.'}));
   return;
  }
  const waitForResult = req.url === '/plan';
  if(req.method!=='POST'||(!waitForResult&&req.url!=='/jobs')){res.writeHead(404);res.end(JSON.stringify({error:'Percorso non disponibile.'}));return;}
  if(!req.headers['content-type']?.startsWith('application/json')){res.writeHead(415);res.end(JSON.stringify({error:'JSON richiesto.'}));return;}
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of req) {
   size += chunk.length;
   if (size > 20000) throw Object.assign(Error('Richiesta troppo grande.'), {status: 413});
   chunks.push(chunk);
  }
  const body = JSON.parse(Buffer.concat(chunks).toString('utf8'));
  if (!body || typeof body !== 'object' || Array.isArray(body)) throw Error('Richiesta non valida.');
  const receipt = await jobs.submit(waitForResult ? {...body, session:'00000000-0000-0000-0000-000000000000'} : body);
  if (!waitForResult) {
   res.writeHead(202);
   res.end(JSON.stringify(receipt));
   return;
  }
  while (!res.destroyed) {
   const job = await jobs.read(receipt.id);
   if (job?.status === 'done') {res.end(JSON.stringify(job.result));return;}
   if (!job || job.status === 'failed') throw Object.assign(Error(job?.error ?? 'Lavoro non trovato.'), {status: job?.statusCode});
   await new Promise(resolve => setTimeout(resolve, 250));
  }
 }catch(e:any){res.writeHead(e.status===429?429:e.status===413?413:400);res.end(JSON.stringify({error:e instanceof SyntaxError?'Risposta o richiesta JSON non valida.':e.message??'Operazione non riuscita.'}));}
}).listen(8787,'127.0.0.1',()=>console.log('Gateway gratuito di sviluppo: http://127.0.0.1:8787. Nessun provider abilitato senza configurazione.'));
