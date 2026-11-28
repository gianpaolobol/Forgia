import {createServer, type IncomingMessage, type ServerResponse} from 'node:http';
import type {RemoteNodeStatus} from './remoteNodeStatus.ts';
import {remoteStatusPage,remoteStatusCss,remoteStatusScript} from './remoteStatusPage.ts';

// Optional, separate diagnostic-only backend for a *trusted local* HTTPS identity
// proxy. It does not run or configure Tailscale, terminate TLS, prove MFA,
// authorize a device, or expose a listener beyond IPv4 loopback.
// Local processes can forge proxy headers: an operator grant is also required.
export type PrivateOperatorConfig={host:string;login:string;port:number};
const loginPattern=/^[a-zA-Z0-9._+%-]{1,128}@[a-zA-Z0-9.-]{1,128}$/;
const label='[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?';
const hostPattern=new RegExp('^'+label+'\\.'+label+'\\.ts\\.net$');
const count=(req:IncomingMessage,name:string)=>req.rawHeaders.filter((v,i)=>i%2===0&&v.toLowerCase()===name).length;
const privatePage=remoteStatusPage.replaceAll('stato locale','stato privato')
  .replace('Solo questo computer. Nessun comando remoto.','Accesso privato autorizzato. Solo diagnostica; nessun comando remoto.')
  .replace('</main>', '<section><h2>Ricevuta diagnostica</h2><p>Genera e conserva la chiave prima di inviare. Se la risposta si perde, cerca la ricevuta con la stessa chiave e lo stesso grant prima di considerare qualsiasi reinvio. Il grant viene svuotato a ogni richiesta.</p><label for="snapshot-key">Chiave richiesta</label><input id="snapshot-key" autocomplete="off" autocapitalize="none" spellcheck="false" maxlength="64"><button id="snapshot-new" type="button">Genera chiave</button><button id="snapshot-send" type="button">Richiedi ricevuta</button><button id="snapshot-lookup" type="button">Cerca ricevuta (senza reinvio)</button><label for="snapshot-id">ID ricevuta</label><input id="snapshot-id" autocomplete="off" autocapitalize="none" spellcheck="false" maxlength="36"><button id="snapshot-read" type="button">Leggi ricevuta</button><p id="snapshot-result" role="status" aria-live="polite"></p></section></main>');
const privateScript=remoteStatusScript+'\n'+"\n(() => {\n'use strict';\nconst grant=document.getElementById('grant'), key=document.getElementById('snapshot-key'), id=document.getElementById('snapshot-id'), fresh=document.getElementById('snapshot-new'), send=document.getElementById('snapshot-send'), read=document.getElementById('snapshot-read'), lookup=document.getElementById('snapshot-lookup'), result=document.getElementById('snapshot-result');\nconst idPattern=/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/;\nlet pending=null;\nfunction clear(){if(pending)pending.abort();pending=null;grant.value='';key.value='';id.value='';result.textContent='';send.disabled=read.disabled=fresh.disabled=lookup.disabled=false;}\naddEventListener('pagehide',clear);addEventListener('pageshow',e=>{if(e.persisted)clear();});\nfresh.addEventListener('click',()=>{if(pending)return;key.value=crypto.randomUUID();id.value='';result.textContent='Conserva questa chiave prima di inviare.';});\nasync function run(mode){\n const submit=mode==='submit',recover=mode==='lookup';\n if(pending)return;\n const token=grant.value;grant.value='';\n if(!/^[a-f0-9]{64}$/.test(token)){result.textContent='Grant operatore non valido.';return;}\n const value=submit||recover?key.value:id.value;\n if((submit||recover)?!/^[a-zA-Z0-9_-]{16,64}$/.test(value):!idPattern.test(value)){result.textContent='Chiave o ID non valido.';return;}\n const controller=new AbortController();pending=controller;send.disabled=read.disabled=fresh.disabled=lookup.disabled=true;\n const timer=setTimeout(()=>controller.abort(),5000);\n try{\n   const headers={Authorization:'Bearer '+token,Accept:'application/json'};\n   if(submit||recover)headers['Idempotency-Key']=value;\n   const response=await fetch(submit||recover?'/v1/snapshots':'/v1/snapshots/'+value,{method:submit?'POST':'GET',headers,credentials:'omit',cache:'no-store',redirect:'error',signal:controller.signal});\n   if(response.redirected||response.status!==(submit?202:200)||response.headers.get('content-type')!=='application/json; charset=utf-8')throw Error('response');\n   const body=await response.text();if(body.length>1024)throw Error('response');\n   const v=JSON.parse(body);\n   if(!v||typeof v!=='object'||Array.isArray(v)||!(typeof v.id==='string'&&idPattern.test(v.id)||recover&&v.id===null))throw Error('response');\n   if(pending!==controller)return;\n   if(recover){if(Object.keys(v).length!==1)throw Error('response');id.value=v.id??'';result.textContent=v.id?'Ricevuta ritrovata. Leggi lo stato con il grant.':'Nessuna ricevuta trovata con questo grant e chiave. Nessun reinvio effettuato.';}\n   else if(submit){if(Object.keys(v).length!==1)throw Error('response');id.value=v.id;result.textContent='Ricevuta acquisita. Leggi lo stato con il grant.';}\n   else{\n     if(v.id!==value||!['queued','done','cancelled'].includes(v.state))throw Error('response');\n     result.textContent='Stato: '+({queued:'in attesa',done:'completata',cancelled:'annullata'}[v.state]);\n   }\n }catch{if(pending===controller)result.textContent=submit?'Esito non confermato. Cerca la ricevuta con la stessa chiave e lo stesso grant, senza reinviare.':'Ricevuta non disponibile. Verifica grant e ID.';}\n finally{clearTimeout(timer);if(pending===controller){pending=null;send.disabled=read.disabled=fresh.disabled=lookup.disabled=false;}}\n}\nsend.addEventListener('click',()=>run('submit'));read.addEventListener('click',()=>run('read'));lookup.addEventListener('click',()=>run('lookup'));\n})();\n";
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

export async function listenPrivateOperator(store:Pick<RemoteNodeStatus,'status'|'requestSnapshot'|'readSnapshot'|'findSnapshot'>,config:PrivateOperatorConfig){
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
    const submit=req.method==='POST'&&req.url==='/v1/snapshots';
    const lookup=req.method==='GET'&&req.url==='/v1/snapshots'&&req.headers['idempotency-key']!==undefined;
    if((req.method!=='GET'&&!submit)||req.headers['transfer-encoding']!==undefined||
       count(req,'content-length')>1||
       (req.headers['content-length']!==undefined&&req.headers['content-length']!=='0')){
      reply(res,400,{error:'invalid_request'});return;
    }
    if(lookup&&(site!=='same-origin'||count(req,'idempotency-key')!==1||typeof req.headers['idempotency-key']!=='string'||!/^[a-zA-Z0-9_-]{16,64}$/.test(req.headers['idempotency-key']))){
      reply(res,400,{error:'invalid_request'});return;
    }
    if(submit&&(count(req,'origin')!==1||req.headers.origin!==origin||site!=='same-origin'||count(req,'idempotency-key')!==1||typeof req.headers['idempotency-key']!=='string'||!/^[a-zA-Z0-9_-]{16,64}$/.test(req.headers['idempotency-key']))){
      reply(res,400,{error:'invalid_request'});return;
    }
    if(req.url==='/operator'||req.url==='/operator.css'||req.url==='/operator.js'){
      const [type,body]=req.url==='/operator'?['text/html',privatePage]:req.url==='/operator.css'?['text/css',remoteStatusCss]:['text/javascript',privateScript];
      res.writeHead(200,{...headers,'Content-Type':type+'; charset=utf-8'});res.end(body);return;
    }
    const receipt=req.method==='GET'&&/^\/v1\/snapshots\/([a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12})$/.exec(req.url??'');
    if(req.url!=='/v1/status'&&!submit&&!receipt&&!lookup){reply(res,404,{error:'not_found'});return;}
    const auth=req.headers.authorization;
    const match=typeof auth==='string'&&count(req,'authorization')===1&&/^Bearer ([a-f0-9]{64})$/.exec(auth);
    if(!match){reply(res,401,{error:'unauthorized'});return;}
    try{
      if(submit){reply(res,202,store.requestSnapshot(match[1],req.headers['idempotency-key'] as string));return;}
      if(lookup){reply(res,200,store.findSnapshot(match[1],req.headers['idempotency-key'] as string));return;}
      if(receipt){reply(res,200,store.readSnapshot(match[1],receipt[1]));return;}
      reply(res,200,store.status(match[1]));
    }
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
