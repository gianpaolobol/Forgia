import {createServer, type IncomingMessage, type ServerResponse} from 'node:http';
import {createServer as createHttpsServer} from 'node:https';
import {readFile} from 'node:fs/promises';
import {pilotGrant, pilotGrantActive, pilotBindHost, validatePilotAccounts} from './pilot.ts';
import {resolve} from 'node:path';
import {createProvider,localProvider} from './providers.ts';
import {resolveModelRegistry} from './modelRegistry.ts';
import {createGateway} from './gateway.ts';
import {parseFit} from './routing.ts';
import {diskStorage} from './disk.ts';
import {createJobs} from './jobs.ts';
import type {JobAuthorization} from './jobAuthorization.ts';
import {createDurableLocalJobs, prepareLocalLedger} from './durableJobs.ts';
import {existsSync} from 'node:fs';
import {prepareCloudState} from './cloudState.ts';
import {knownRoutingStatus} from './routingFailure.ts';
const configs = resolveModelRegistry([
 {id: 'local', prefix: 'OLLAMA', model: process.env.OLLAMA_MODEL ?? ''},
 {id: 'llamacpp', prefix: 'LLAMACPP', model: process.env.LLAMACPP_MODEL ?? ''},
 {id: 'cloudflare', prefix: 'CLOUDFLARE', model: process.env.CLOUDFLARE_MODEL ?? '', accountId: process.env.CLOUDFLARE_ACCOUNT_ID, apiKey: process.env.CLOUDFLARE_API_TOKEN, freePlanConfirmed: process.env.CLOUDFLARE_FREE_PLAN_CONFIRMED === 'true'},
 {id: 'groq', prefix: 'GROQ', model: process.env.GROQ_MODEL ?? '', apiKey: process.env.GROQ_API_KEY, freePlanConfirmed: process.env.GROQ_FREE_PLAN_CONFIRMED === 'true'},
 {id: 'openrouter', prefix: 'OPENROUTER', model: process.env.OPENROUTER_MODEL ?? '', apiKey: process.env.OPENROUTER_API_KEY},
],process.env.FORGIA_MODEL_REGISTRY);
const dataDirectory = resolve(process.env.FORGIA_DATA_DIR || '.data');
const sqliteLocal = process.env.FORGIA_SQLITE_LOCAL === '1';
const sqliteInitialize = process.env.FORGIA_SQLITE_INITIALIZE === '1';
if (sqliteInitialize && !sqliteLocal) throw Error('Inizializzazione SQLite richiede modalità locale esplicita.');
if (sqliteLocal && (process.env.FORGIA_PILOT_HOST || process.env.FORGIA_DISABLE_WEB_GATEWAY === '1')) throw Error('SQLite pilota consentito solo sul gateway web loopback.');
const sqliteDirectory = resolve(dataDirectory,'sqlite-loopback');
if (!sqliteLocal && existsSync(sqliteDirectory)) throw Error('Archivio SQLite presente: non avviare la vecchia coda JSON. Ripristino offline necessario.');
const storage = diskStorage(dataDirectory);
const sqliteCloudState = process.env.FORGIA_SQLITE_CLOUD_STATE === '1';
const sqliteCloudInitialize = process.env.FORGIA_SQLITE_CLOUD_INITIALIZE === '1';
if (sqliteCloudInitialize && !sqliteCloudState) throw Error('Inizializzazione quota/cache richiede opt-in.');
if (sqliteCloudState && (!sqliteLocal || sqliteInitialize)) throw Error('Quota/cache richiede coda SQLite già migrata, senza inizializzazione concorrente.');
if (!sqliteCloudState && existsSync(resolve(sqliteDirectory,'cloud.sqlite'))) throw Error('Archivio quota/cache presente: mantenere opt-in o ripristinare offline.');
const localLedger = sqliteLocal ? prepareLocalLedger(sqliteDirectory,await storage.getItem('jobs.v1') ?? '[]',sqliteInitialize) : undefined;
// Cloud providers remain disabled in SQLite local mode. This prepares the
// persistent state without enabling any external inference or pilot access.
const cloudState = sqliteCloudState ? prepareCloudState(sqliteDirectory,sqliteCloudInitialize,
  sqliteCloudInitialize ? await storage.getItem('gateway.v1') : null) : undefined;
const gateway = createGateway(storage,{...cloudState,localCooldownLedger:localLedger});
function configuredProvider(config: typeof configs[number]) {
 return createProvider({...config, fit: parseFit(config.fitRaw ?? process.env[config.prefix + '_FIT'])});
}
async function executePlan({idea, provider, consent, context}: import('./durableWorker.ts').DurableInput, backlog: number, session: string, isolated: boolean, signal?: AbortSignal) {
  const scope = isolated ? session : undefined;
  const available = sqliteLocal ? configs.filter(c => localProvider(c.id)) : configs;
  if (provider === 'auto') {
   const providers = available.flatMap(config => {
    try { return [configuredProvider(config)]; } catch { return []; }
   });
   return gateway.planAuto(idea, providers, sqliteLocal ? false : consent, context, backlog, scope, signal);
  }
  const config = available.find(c => c.id === provider);
  if (!config) throw Error('Motore non configurato.');
  const selected = configuredProvider(config);
  const result = await gateway.plan(idea, selected, sqliteLocal ? false : consent, scope, signal);
  return {...result, routing: {provider: selected.id, model: selected.model, reason: 'Selezione manuale.', skipped: []}};
}
function buildJobs(store: typeof storage, isolated: boolean, authorize?: JobAuthorization) {
 return createJobs(store,(input,backlog,session,signal,grant)=>executePlan(input,backlog,grant ? `${session}:${grant}` : session,isolated,signal),authorize);
}
const durableJobs = localLedger ? createDurableLocalJobs(
 localLedger,
 (input,backlog,session,signal)=>executePlan(input,backlog,session,true,signal),
) : undefined;
const localJobs = durableJobs ?? buildJobs(storage, false);
const allowed = new Set(['http://localhost:8081', 'http://127.0.0.1:8081']);

function reply(res: ServerResponse, status: number, payload: unknown) {
 res.writeHead(status);
 res.end(JSON.stringify(payload));
}

async function handle(req: IncomingMessage, res: ServerResponse, jobs: typeof localJobs, session?: string, grant?: string) {
 res.setHeader('Cache-Control', 'no-store');
 res.setHeader('Content-Type', 'application/json');
 res.setHeader('X-Content-Type-Options', 'nosniff');
 try{
  if(req.method==='GET'&&req.url==='/providers'){
   const providers = configs.map(config => {
    try {
     if (sqliteLocal && !localProvider(config.id)) throw Error('Cloud disattivato nel pilota SQLite.');
     configuredProvider(config);
     return {id: config.id, model: config.model, profile: config.profile, configured: true};
    } catch {
     return {id: config.id, model: config.model, profile: config.profile, configured: false};
    }
   });
   res.end(JSON.stringify({mode:'free-only',providers,localDevelopmentOnly:session === undefined,durableLocal:session===undefined&&sqliteLocal}));return;
  }
  if (req.method === 'GET' && /^\/jobs\/[a-f0-9-]{36}$/.test(req.url ?? '')) {
   const job = await jobs.read(req.url!.slice(6), session, grant);
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
   (session || sqliteLocal) && typeof requestKey === 'string' ? requestKey : undefined,
   grant,
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
   if ('nextEligibleAt' in job && typeof job.nextEligibleAt === 'number' && job.nextEligibleAt > Date.now()) {
    return reply(res,429,{error:'Lavoro sospeso per quota.',id:receipt.id,nextEligibleAt:job.nextEligibleAt});
   }
   await new Promise(resolve => setTimeout(resolve, 250));
  }
 } catch (error) {
  if (res.destroyed) return;
  const failure = error as {status?: number; code?: string; message?: string};
  // A provider's 401/403 is not the client's authentication failure.
  const upstreamStatus = knownRoutingStatus(failure.status) ? failure.status : undefined;
  const status = upstreamStatus === 401 || upstreamStatus === 403 ? 502 : upstreamStatus ?? (failure.status === 413 || failure.status === 409 ? failure.status : 400);
  const message = error instanceof SyntaxError ? 'Risposta o richiesta JSON non valida.'
   : (session && failure.code ? undefined : failure.message);
  reply(res, status, {error: message ?? 'Operazione non riuscita.', statusCode: upstreamStatus});
 }
}

if (process.env.FORGIA_DISABLE_WEB_GATEWAY !== '1') createServer((req, res) => {
 const origin = req.headers.origin;
 if ((origin && !allowed.has(origin)) || !['127.0.0.1:8787', 'localhost:8787'].includes(req.headers.host ?? '')) {
  res.writeHead(403).end();
  return;
 }
 if (origin) res.setHeader('Access-Control-Allow-Origin', origin);
 res.setHeader('Vary', 'Origin');
 if (req.method === 'OPTIONS') {
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Idempotency-Key');
  res.writeHead(204).end();
  return;
 }
 void handle(req, res, localJobs);
}).listen(8787, '127.0.0.1', () => {
 durableJobs?.start();
 console.log('Gateway gratuito di sviluppo: http://127.0.0.1:8787.');
});

if (process.env.FORGIA_PILOT_HOST) {
 const host = pilotBindHost(process.env.FORGIA_PILOT_HOST);
 const port = Number(process.env.FORGIA_PILOT_PORT || 8443);
 const certPath = process.env.FORGIA_PILOT_TLS_CERT;
 const keyPath = process.env.FORGIA_PILOT_TLS_KEY;
 const pfxPath = process.env.FORGIA_PILOT_TLS_PFX;
 const passphrase = process.env.FORGIA_PILOT_TLS_PFX_PASSWORD;
 const accountsPath = process.env.FORGIA_PILOT_ACCOUNTS;
 if (!accountsPath || !Number.isInteger(port) || port < 1 || port > 65535) {
  throw Error('Porta o credenziali pilota mancanti.');
 }
 const tls = pfxPath && passphrase
  ? {pfx: await readFile(pfxPath), passphrase}
  : certPath && keyPath ? {cert: await readFile(certPath), key: await readFile(keyPath)} : undefined;
 if (!tls) throw Error('Configurazione TLS pilota mancante.');
 const readAccounts = async (): Promise<unknown> => JSON.parse(await readFile(accountsPath, 'utf8'));
 validatePilotAccounts(await readAccounts());
 const pilotJobs = buildJobs(diskStorage(resolve(dataDirectory, 'pilot')), true,
  async (session, grant) => pilotGrantActive(session, grant, await readAccounts()));
 createHttpsServer({...tls, minVersion: 'TLSv1.2', requestTimeout: 15_000, headersTimeout: 10_000}, async (req, res) => {
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('Content-Type', 'application/json');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  if (!/^Bearer [a-f0-9]{64}$/.test(req.headers.authorization ?? '')) {
   return reply(res, 401, {error: 'Codice tester richiesto.'});
  }
  let identity: ReturnType<typeof pilotGrant>;
  try { identity = pilotGrant(req.headers.authorization, await readAccounts()); }
  catch { return reply(res, 503, {error: 'Accesso pilota temporaneamente indisponibile.'}); }
  if (!identity) return reply(res, 401, {error: 'Codice tester scaduto o non valido.'});
  await handle(req, res, pilotJobs, identity.session, identity.grant);
 }).listen(port, host, () => console.log('Gateway HTTPS per tester attivo.'));
}
