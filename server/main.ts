import {createServer, type IncomingMessage, type ServerResponse} from 'node:http';
import {createServer as createHttpsServer} from 'node:https';
import {readFile} from 'node:fs/promises';
import {pilotIdentity} from './pilot.ts';
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
function buildJobs(store: typeof storage, isolated: boolean) {
 return createJobs(store, async ({idea, provider, consent, context}, backlog, session) => {
  const scope = isolated ? session : undefined;
  if (provider === 'auto') {
   const providers = configs.flatMap(config => {
    try { return [configuredProvider(config)]; } catch { return []; }
   });
   return gateway.planAuto(idea, providers, consent, context, backlog, scope);
  }
  const config = configs.find(c => c.id === provider);
  if (!config) throw Error('Motore non configurato.');
  const selected = configuredProvider(config);
  const result = await gateway.plan(idea, selected, consent, scope);
  return {...result, routing: {provider: selected.id, model: selected.model, reason: 'Selezione manuale.', skipped: []}};
 });
}

const localJobs = buildJobs(storage, false);
const allowed = new Set(['http://localhost:8081', 'http://127.0.0.1:8081']);

function reply(res: ServerResponse, status: number, payload: unknown) {
 res.writeHead(status);
 res.end(JSON.stringify(payload));
}

async function handle(req: IncomingMessage, res: ServerResponse, jobs: typeof localJobs, session?: string) {
 res.setHeader('Cache-Control', 'no-store');
 res.setHeader('Content-Type', 'application/json');
 res.setHeader('X-Content-Type-Options', 'nosniff');
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
   res.end(JSON.stringify({mode:'free-only',providers,localDevelopmentOnly:session === undefined}));return;
  }
  if (req.method === 'GET' && /^\/jobs\/[a-f0-9-]{36}$/.test(req.url ?? '')) {
   const job = await jobs.read(req.url!.slice(6), session);
   if (!job) res.writeHead(404);
   res.end(JSON.stringify(job ?? {error:'Lavoro non trovato.'}));
   return;
  }
  const waitForResult = session === undefined && req.url === '/plan';
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
  const requestKey = req.headers['idempotency-key'];
  if (session && (typeof requestKey !== 'string' || !/^[!-~]{1,900}:p[a-z0-9]{1,99}$/.test(requestKey))) {
   return reply(res, 400, {error: 'Identificativo della richiesta non valido.'});
  }
  const receipt = await jobs.submit(
   session ? {...body, session} : waitForResult ? {...body, session:'00000000-0000-0000-0000-000000000000'} : body,
   session && typeof requestKey === 'string' ? requestKey : undefined,
  );
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
 } catch (error) {
  if (res.destroyed) return;
  const failure = error as {status?: number; code?: string; message?: string};
  const status = failure.status === 429 || failure.status === 413 ? failure.status : 400;
  const message = error instanceof SyntaxError ? 'Risposta o richiesta JSON non valida.'
   : (session && failure.code ? undefined : failure.message);
  reply(res, status, {error: message ?? 'Operazione non riuscita.'});
 }
}

createServer((req, res) => {
 const origin = req.headers.origin;
 if ((origin && !allowed.has(origin)) || !['127.0.0.1:8787', 'localhost:8787'].includes(req.headers.host ?? '')) {
  res.writeHead(403).end();
  return;
 }
 if (origin) res.setHeader('Access-Control-Allow-Origin', origin);
 res.setHeader('Vary', 'Origin');
 if (req.method === 'OPTIONS') {
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  res.writeHead(204).end();
  return;
 }
 void handle(req, res, localJobs);
}).listen(8787, '127.0.0.1', () => console.log('Gateway gratuito di sviluppo: http://127.0.0.1:8787.'));

if (process.env.FORGIA_PILOT_HOST) {
 const host = process.env.FORGIA_PILOT_HOST;
 const port = Number(process.env.FORGIA_PILOT_PORT || 8443);
 const certPath = process.env.FORGIA_PILOT_TLS_CERT;
 const keyPath = process.env.FORGIA_PILOT_TLS_KEY;
 const accountsPath = process.env.FORGIA_PILOT_ACCOUNTS;
 if (!certPath || !keyPath || !accountsPath || !Number.isInteger(port) || port < 1 || port > 65535) {
  throw Error('Configurazione TLS o credenziali pilota mancanti.');
 }
 const [cert, key] = await Promise.all([readFile(certPath), readFile(keyPath)]);
 const readAccounts = async (): Promise<unknown> => JSON.parse(await readFile(accountsPath, 'utf8'));
 if (!Array.isArray(await readAccounts())) throw Error('Elenco tester pilota non valido.');
 const pilotJobs = buildJobs(diskStorage(resolve('.data', 'pilot')), true);
 createHttpsServer({cert, key, minVersion: 'TLSv1.2', requestTimeout: 15_000, headersTimeout: 10_000}, async (req, res) => {
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('Content-Type', 'application/json');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  if (!/^Bearer [a-f0-9]{64}$/.test(req.headers.authorization ?? '')) {
   return reply(res, 401, {error: 'Codice tester richiesto.'});
  }
  let session: string | undefined;
  try { session = pilotIdentity(req.headers.authorization, await readAccounts()); }
  catch { return reply(res, 503, {error: 'Accesso pilota temporaneamente indisponibile.'}); }
  if (!session) return reply(res, 401, {error: 'Codice tester scaduto o non valido.'});
  await handle(req, res, pilotJobs, session);
 }).listen(port, host, () => console.log('Gateway HTTPS per tester attivo.'));
}
