import {createServer, type IncomingMessage, type ServerResponse} from 'node:http';
import type {RemoteNodeStatus} from './remoteNodeStatus.ts';
import {remoteStatusPage,remoteStatusCss,remoteStatusScript} from './remoteStatusPage.ts';

// Separate loopback-only status transport. No gateway proxy, commands,
// enrollment or administrative routes. Private TLS/MFA proxy is future work.
const MAX_BODY = 128;
const tokenHeader = /^Bearer ([a-f0-9]{64})$/;
const rawCount = (req: IncomingMessage, name: string) =>
  req.rawHeaders.filter((v,i) => i % 2 === 0 && v.toLowerCase() === name).length;

function reply(res: ServerResponse, status: number, value: object) {
  res.writeHead(status, {
    'Content-Type':'application/json; charset=utf-8',
    'Cache-Control':'no-store', 'X-Content-Type-Options':'nosniff',
    'Connection':'close', 'Content-Security-Policy':"default-src 'none'",
    'Referrer-Policy':'no-referrer',
  });
  res.end(JSON.stringify(value));
}

async function heartbeatBody(req: IncomingMessage): Promise<number> {
  const length = req.headers['content-length'];
  if (req.headers['transfer-encoding'] !== undefined ||
      typeof length !== 'string' || !/^[1-9][0-9]{0,2}$/.test(length) ||
      Number(length) > MAX_BODY ||
      req.headers['content-type'] !== 'application/json') throw Error('body');
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of req) {
    const bytes = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    size += bytes.length;
    if (size > MAX_BODY || size > Number(length)) throw Error('body');
    chunks.push(bytes);
  }
  if (size !== Number(length)) throw Error('body');
  const value: unknown = JSON.parse(Buffer.concat(chunks).toString('utf8'));
  if (!value || typeof value !== 'object' || Array.isArray(value) ||
      Object.keys(value).length !== 1 || !('sequence' in value) ||
      typeof value.sequence !== 'number' || !Number.isSafeInteger(value.sequence) ||
      value.sequence <= 0) throw Error('body');
  return value.sequence;
}

export async function listenRemoteStatus(store: Pick<RemoteNodeStatus,'status'|'heartbeat'>, port = 0) {
  if (!Number.isInteger(port) || port < 0 || port > 65535 || port === 8787) throw Error('Invalid status port');
  const server = createServer({requestTimeout:5000, headersTimeout:5000, maxHeaderSize:4096}, async (req,res) => {
    const address = server.address();
    const host = address && typeof address !== 'string' ? '127.0.0.1:'+address.port : '';
    if (req.socket.remoteAddress !== '127.0.0.1' ||
        rawCount(req,'host') !== 1 || req.headers.host !== host ||
        rawCount(req,'origin') > 1 ||
        (req.headers.origin !== undefined && req.headers.origin !== 'http://'+host) ||
        req.headers['sec-fetch-site'] === 'cross-site' ||
        req.headers['sec-fetch-site'] === 'same-site') {
      reply(res,403,{error:'forbidden'}); return;
    }
    if(req.method==='GET' && (req.url==='/operator'||req.url==='/operator.css'||req.url==='/operator.js')){
      if(req.headers['transfer-encoding']!==undefined||(req.headers['content-length']!==undefined&&req.headers['content-length']!=='0')){
        reply(res,400,{error:'invalid_request'});return;
      }
      const [type,body]=req.url==='/operator'?['text/html',remoteStatusPage]:req.url==='/operator.css'?['text/css',remoteStatusCss]:['text/javascript',remoteStatusScript];
      res.writeHead(200,{'Content-Type':type+'; charset=utf-8','Cache-Control':'no-store','X-Content-Type-Options':'nosniff','Connection':'close','Referrer-Policy':'no-referrer','X-Frame-Options':'DENY','Content-Security-Policy':"default-src 'none'; script-src 'self'; style-src 'self'; connect-src 'self'; base-uri 'none'; frame-ancestors 'none'; form-action 'none'"});
      res.end(body);return;
    }
    const status = req.method === 'GET' && req.url === '/v1/status';
    const beat = req.method === 'POST' && req.url === '/v1/heartbeat';
    if (!status && !beat) { reply(res,404,{error:'not_found'}); return; }
    const header = req.headers.authorization;
    const match = typeof header === 'string' && rawCount(req,'authorization') === 1 && tokenHeader.exec(header);
    if (!match) { reply(res,401,{error:'unauthorized'}); return; }
    if (status && (req.headers['transfer-encoding'] !== undefined ||
        (req.headers['content-length'] !== undefined && req.headers['content-length'] !== '0'))) {
      reply(res,400,{error:'invalid_request'}); return;
    }
    let sequence = 0;
    if (beat) {
      try { sequence = await heartbeatBody(req); }
      catch { if (!res.destroyed) reply(res,400,{error:'invalid_request'}); return; }
    }
    try {
      const value = status ? store.status(match[1]) : store.heartbeat(match[1],sequence);
      reply(res,200,value);
    } catch {
      // No tokens, database details or node enumeration in errors.
      reply(res,401,{error:'unauthorized'});
    }
  });
  server.maxRequestsPerSocket = 1;
  server.setTimeout(5000, socket => socket.destroy());
  await new Promise<void>((resolve,reject) => {
    server.once('error',reject);
    server.listen(port,'127.0.0.1',() => {
      server.removeListener('error',reject);
      resolve();
    });
  });
  return server;
}
