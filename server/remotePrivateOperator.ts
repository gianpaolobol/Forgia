import {createServer, type IncomingMessage, type ServerResponse} from 'node:http';
import type {RemoteNodeStatus} from './remoteNodeStatus.ts';
import {remoteStatusPage,remoteStatusCss,remoteStatusScript} from './remoteStatusPage.ts';

// Optional, separate read-only backend for a *trusted local* HTTPS identity
// proxy. It does not run or configure Tailscale, terminate TLS, prove MFA,
// authorize a device, or expose a listener beyond IPv4 loopback.
// Local processes can forge proxy headers: an operator grant is also required.
export type PrivateOperatorConfig={host:string;login:string;port:number};
const loginPattern=/^[a-zA-Z0-9._+%-]{1,128}@[a-zA-Z0-9.-]{1,128}$/;
const label='[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?';
const hostPattern=new RegExp('^'+label+'\\.'+label+'\\.ts\\.net$');
const count=(req:IncomingMessage,name:string)=>req.rawHeaders.filter((v,i)=>i%2===0&&v.toLowerCase()===name).length;
const privatePage=remoteStatusPage.replaceAll('stato locale','stato privato')
  .replace('Solo questo computer. Nessun comando remoto.','Accesso privato autorizzato. Sola lettura; nessun comando remoto.');
const headers={
  'Cache-Control':'no-store','X-Content-Type-Options':'nosniff',
  'Connection':'close','Referrer-Policy':'no-referrer','X-Frame-Options':'DENY',
  'Cross-Origin-Resource-Policy':'same-origin',
  'Content-Security-Policy':"default-src 'none'; script-src 'self'; style-src 'self'; connect-src 'self'; base-uri 'none'; frame-ancestors 'none'; form-action 'none'",
};
function reply(res:ServerResponse,status:number,value:object){
  res.writeHead(status,{...headers,'Content-Type':'application/json; charset=utf-8'});
  res.end(JSON.stringify(value));
}

export async function listenPrivateOperator(store:Pick<RemoteNodeStatus,'status'>,config:PrivateOperatorConfig){
  const {host,login,port}=config;
  if(typeof host!=='string'||!hostPattern.test(host)||typeof login!=='string'||!loginPattern.test(login)||
     !Number.isInteger(port)||port<0||port>65535||port===8787)
    throw Error('Invalid private operator configuration');
  const origin='https://'+host;
  const server=createServer({requestTimeout:5000,headersTimeout:5000,maxHeaderSize:4096},(req,res)=>{
    const site=req.headers['sec-fetch-site'];
    if(req.socket.remoteAddress!=='127.0.0.1'||
       count(req,'host')!==1||req.headers.host!==host||
       count(req,'tailscale-user-login')!==1||req.headers['tailscale-user-login']!==login||
       count(req,'x-forwarded-proto')!==1||req.headers['x-forwarded-proto']!=='https'||
       count(req,'origin')>1||(req.headers.origin!==undefined&&req.headers.origin!==origin)||
       count(req,'sec-fetch-site')>1||(site!==undefined&&site!=='same-origin'&&site!=='none')){
      reply(res,403,{error:'forbidden'});return;
    }
    if(req.method!=='GET'||req.headers['transfer-encoding']!==undefined||
       count(req,'content-length')>1||
       (req.headers['content-length']!==undefined&&req.headers['content-length']!=='0')){
      reply(res,400,{error:'invalid_request'});return;
    }
    if(req.url==='/operator'||req.url==='/operator.css'||req.url==='/operator.js'){
      const [type,body]=req.url==='/operator'?['text/html',privatePage]:req.url==='/operator.css'?['text/css',remoteStatusCss]:['text/javascript',remoteStatusScript];
      res.writeHead(200,{...headers,'Content-Type':type+'; charset=utf-8'});res.end(body);return;
    }
    if(req.url!=='/v1/status'){reply(res,404,{error:'not_found'});return;}
    const auth=req.headers.authorization;
    const match=typeof auth==='string'&&count(req,'authorization')===1&&/^Bearer ([a-f0-9]{64})$/.exec(auth);
    if(!match){reply(res,401,{error:'unauthorized'});return;}
    try{reply(res,200,store.status(match[1]));}
    catch{reply(res,401,{error:'unauthorized'});}
  });
  server.maxRequestsPerSocket=1;
  server.setTimeout(5000,socket=>socket.destroy());
  await new Promise<void>((resolve,reject)=>{
    server.once('error',reject);
    server.listen(port,'127.0.0.1',()=>{server.removeListener('error',reject);resolve();});
  });
  return server;
}
