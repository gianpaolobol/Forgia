import {createServer} from 'node:http';
import {resolve} from 'node:path';
import {createProvider} from './providers.ts';
import {createGateway} from './gateway.ts';
import {parseFit, routingContext} from './routing.ts';
import {diskStorage} from './disk.ts';
const gateway=createGateway(diskStorage(resolve('.data')));
const configs = [
 {id: 'local', prefix: 'OLLAMA', model: process.env.OLLAMA_MODEL ?? ''},
 {id: 'groq', prefix: 'GROQ', model: process.env.GROQ_MODEL ?? '', apiKey: process.env.GROQ_API_KEY, freePlanConfirmed: process.env.GROQ_FREE_PLAN_CONFIRMED === 'true'},
 {id: 'openrouter', prefix: 'OPENROUTER', model: process.env.OPENROUTER_MODEL ?? '', apiKey: process.env.OPENROUTER_API_KEY},
];
function configuredProvider(config: typeof configs[number]) {
 return createProvider({...config, fit: parseFit(process.env[config.prefix + '_FIT'])});
}
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
  if(req.method!=='POST'||req.url!=='/plan'){res.writeHead(404);res.end(JSON.stringify({error:'Percorso non disponibile.'}));return;}
  if(!req.headers['content-type']?.startsWith('application/json')){res.writeHead(415);res.end(JSON.stringify({error:'JSON richiesto.'}));return;}
  let raw='';for await(const chunk of req){raw+=chunk.toString();if(Buffer.byteLength(raw)>20000)throw Object.assign(Error('Richiesta troppo grande.'),{status:413});}
  const body = JSON.parse(raw);
  const consent = body.cloudConsent === true;
  if (body.provider === 'auto') {
   const providers = configs.flatMap(config => {
    try { return [configuredProvider(config)]; } catch { return []; }
   });
   const result = await gateway.planAuto(body.idea, providers, consent, routingContext(body.kind, body.phase));
   res.end(JSON.stringify(result));
   return;
  }
  const config = configs.find(c => c.id === body.provider);
  if (!config) throw Error('Fornitore non configurato.');
  const provider = configuredProvider(config);
  const result = await gateway.plan(body.idea, provider, consent);
  res.end(JSON.stringify({...result, routing: {provider: provider.id, model: provider.model, reason: 'Selezione manuale.', skipped: []}}));
 }catch(e:any){res.writeHead(e.status===429?429:e.status===413?413:400);res.end(JSON.stringify({error:e instanceof SyntaxError?'Risposta o richiesta JSON non valida.':e.message??'Operazione non riuscita.'}));}
}).listen(8787,'127.0.0.1',()=>console.log('Gateway gratuito di sviluppo: http://127.0.0.1:8787. Nessun provider abilitato senza configurazione.'));
