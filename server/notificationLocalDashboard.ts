import {createServer,type IncomingMessage,type ServerResponse} from 'node:http';
import {randomBytes,timingSafeEqual} from 'node:crypto';
import {NotificationLocalRuntime} from './notificationLocalRuntime.ts';

const MAX_FORM=2048;
const esc=(x:unknown)=>String(x).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]!));
function equal(a:unknown,b:string){
  if(typeof a!=='string'||a.length!==b.length)return false;
  const x=Buffer.from(a),y=Buffer.from(b);
  return x.length===y.length&&timingSafeEqual(x,y);
}
function date(x:unknown){
  const d=new Date(Number(x));return Number.isFinite(d.getTime())?d.toISOString().slice(0,16).replace('T',' ')+' UTC':'Data non valida';
}
function clock(x:unknown){
  const n=Number(x);return Number.isInteger(n)&&n>=0&&n<1440?String(Math.floor(n/60)).padStart(2,'0')+':'+String(n%60).padStart(2,'0'):'';
}
const field=(name:string,value:unknown)=>'<input type="hidden" name="'+esc(name)+'" value="'+esc(value)+'">';
const button=(label:string)=>'<button type="submit">'+esc(label)+'</button>';
function form(action:string,csrf:string,body:string){return '<form method="post" action="/'+action+'">'+field('csrf',csrf)+body+'</form>';}
function evidence(project:string,url:unknown){
  if(typeof url!=='string')return '';
  const prefix='https://github.com/'+project+'/';
  return url.startsWith(prefix)&&/^(?:issues|pull|actions\/runs)\/[1-9][0-9]{0,19}$/.test(url.slice(prefix.length))
    ? '<a rel="noreferrer noopener" target="_blank" href="'+esc(url)+'">Evidenza GitHub</a>':'';
}
function render(runtime:NotificationLocalRuntime,csrf:string,unread:boolean){
  const v=runtime.snapshot(unread,100);
  const items=v.events.map(({event:e,readAt})=>'<article><p class="meta">'+esc(e.severity)+' · '+esc(date(e.timestamp))+' · '+(readAt===null?'Non letta':'Letta')+'</p><h3>'+esc(e.summary)+'</h3><p>'+evidence(v.project,e.evidence_url)+'</p>'+
    (readAt===null?form('read',csrf,field('source',e.source)+field('id',e.id)+button('Segna come letta')):'')+'</article>').join('');
  const channels=v.channels.map(c=>'<article><h3>'+esc(c.channel)+'</h3><p>Preferenza: '+(c.preferenceEnabled?'attiva':'disattiva')+' · Trasporto non attivo in questo pannello</p>'+
    (c.preferenceEnabled?form('revoke',csrf,field('channel',c.channel)+button('Revoca per questo progetto')):'')+
    '<ul>'+v.delivery.filter(d=>d.channel===c.channel).map(d=>'<li>'+esc(d.state)+': '+esc(d.count)+'</li>').join('')+'</ul></article>').join('');
  const digests=v.digests.map(d=>'<article><h3>'+esc(date(d.slot))+'</h3><p>'+esc(d.total)+' eventi · '+esc(d.critical)+' critici · '+esc(d.warning)+' avvisi · '+esc(d.info)+' info'+(d.more?' · altri in attesa':'')+'</p></article>').join('');
  return '<!doctype html><html lang="it"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Forgia Notification Hub</title><style>'+
    'html{color-scheme:light dark;font:16px system-ui}body{max-width:900px;margin:auto;padding:1rem}h1,h2,h3{line-height:1.2}article{border:1px solid #888;border-radius:12px;padding:1rem;margin:.6rem 0;overflow-wrap:anywhere}button,input{font:inherit;padding:.55rem;margin:.25rem;max-width:100%}nav a{display:inline-block;padding:.5rem}.meta{font-size:.9rem}form{margin:.4rem 0}a:focus,button:focus,input:focus{outline:3px solid #66aaff}'+
    '</style></head><body><header><h1>Forgia · Notifiche</h1><p>Progetto: '+esc(v.project)+'</p><p>'+esc(v.unread)+' non lette / '+esc(v.total)+' totali · Solo operatore locale</p></header><nav><a href="/">Tutte</a><a href="/?unread=1">Non lette</a></nav><main>'+
    '<section><h2>Inbox</h2><p>Ultimi 100 eventi del progetto selezionato.</p>'+(items||'<p>Nessun evento in questa vista.</p>')+'</section>'+
    '<section><h2>Riepiloghi</h2><p>Orario UTC: '+(v.schedule.minute===null?'disattivato':esc(clock(v.schedule.minute)))+' · prossimo: '+(v.schedule.nextAt===null?'—':esc(date(v.schedule.nextAt)))+'</p>'+
    form('schedule',csrf,'<label>Orario UTC <input required type="time" name="time" value="'+esc(v.schedule.minute===null?'09:00':clock(v.schedule.minute))+'"></label>'+button('Salva orario'))+
    form('schedule',csrf,field('time','off')+button('Disattiva riepilogo'))+
    form('tick',csrf,button('Controlla riepilogo ora'))+'<p>Per esecuzione automatica avviare separatamente il comando watch locale.</p>'+(digests||'<p>Nessun riepilogo.</p>')+'</section>'+
    '<section><h2>Canali esterni</h2><p>Non è possibile attivare o inviare notifiche da questa pagina. Sent indica accettazione del provider, non recapito.</p>'+channels+'</section></main></body></html>';
}
function headers(res:ServerResponse){
  res.setHeader('Cache-Control','no-store');
  res.setHeader('X-Content-Type-Options','nosniff');
  res.setHeader('Referrer-Policy','no-referrer');
  res.setHeader('X-Frame-Options','DENY');
  res.setHeader('Content-Security-Policy',"default-src 'none'; style-src 'unsafe-inline'; form-action 'self'; base-uri 'none'; frame-ancestors 'none'");
}
function reply(res:ServerResponse,status:number,body=''){
  res.writeHead(status,{'Content-Type':'text/plain; charset=utf-8'});res.end(body);
}
async function readForm(req:IncomingMessage){
  if(req.headers['content-type']!=='application/x-www-form-urlencoded')throw Error('Invalid form');
  const chunks:Buffer[]=[];let size=0;
  for await(const chunk of req){const b=Buffer.from(chunk);size+=b.length;if(size>MAX_FORM)throw Error('Invalid form');chunks.push(b);}
  const f=new URLSearchParams(Buffer.concat(chunks).toString('utf8'));
  if([...f.keys()].some(k=>f.getAll(k).length!==1))throw Error('Invalid form');
  return f;
}
function exact(f:URLSearchParams,keys:string[]){return [...f.keys()].length===keys.length&&keys.every(k=>f.has(k));}

// Dedicated local operator UI, not a multi-tenant or remote gateway.
// No listener on LAN, no CORS, no credential persistence, no external transports.
export async function startNotificationDashboard(runtime:NotificationLocalRuntime,port=0){
  if(!Number.isInteger(port)||port<0||port>65535)throw Error('Invalid port');
  const password=randomBytes(32).toString('base64url'),csrf=randomBytes(32).toString('base64url');
  const auth='Basic '+Buffer.from('operator:'+password).toString('base64');
  let origin='',host='';
  const server=createServer({requestTimeout:5000,headersTimeout:5000,maxHeaderSize:8192},async(req,res)=>{
    headers(res);
    try{
      if(req.socket.remoteAddress!=='127.0.0.1'||req.headers.host!==host){reply(res,403,'Accesso locale richiesto');return;}
      if(req.headers['sec-fetch-site']==='cross-site'){reply(res,403,'Origine non autorizzata');return;}
      if(!equal(req.headers.authorization,auth)){
        res.setHeader('WWW-Authenticate','Basic realm="Forgia locale", charset="UTF-8"');reply(res,401,'Autenticazione richiesta');return;
      }
      if(req.method==='GET'&&(req.url==='/'||req.url==='/?unread=1')){
        res.writeHead(200,{'Content-Type':'text/html; charset=utf-8'});res.end(render(runtime,csrf,req.url!=='/'));return;
      }
      if(req.method!=='POST'||!['/read','/revoke','/schedule','/tick'].includes(req.url??'')){reply(res,404,'Non disponibile');return;}
      if(req.headers.origin!==origin){reply(res,403,'Origine non autorizzata');return;}
      const f=await readForm(req);
      if(!equal(f.get('csrf'),csrf)){reply(res,403,'Sessione non autorizzata');return;}
      // No owner/project parameters are accepted, even with correct credentials.
      switch(req.url){
        case '/read':
          if(!exact(f,['csrf','source','id'])||!runtime.markRead(f.get('source')!,f.get('id')!)){reply(res,404,'Evento non disponibile');return;}break;
        case '/revoke':{
          const c=f.get('channel');
          if(!exact(f,['csrf','channel'])||(c!=='email'&&c!=='telegram'&&c!=='push'))throw Error('Invalid channel');
          runtime.revoke(c);break;
        }
        case '/schedule':{
          const time=f.get('time')!;
          if(!exact(f,['csrf','time']))throw Error('Invalid schedule');
          if(time==='off')runtime.schedule(null);
          else {if(!/^(?:[01][0-9]|2[0-3]):[0-5][0-9]$/.test(time))throw Error('Invalid schedule');
            runtime.schedule(Number(time.slice(0,2))*60+Number(time.slice(3)));}
          break;
        }
        case '/tick':
          if(!exact(f,['csrf']))throw Error('Invalid tick');runtime.tick();break;
      }
      res.writeHead(303,{Location:'/'});res.end();
    }catch{if(!res.headersSent)reply(res,400,'Richiesta non valida o archivio non disponibile');else res.destroy();}
  });
  server.maxHeadersCount=32;server.setTimeout(5000,socket=>socket.destroy());
  await new Promise<void>((resolve,reject)=>{
    server.once('error',reject);
    server.listen(port,'127.0.0.1',()=>{server.off('error',reject);resolve();});
  });
  const address=server.address();
  if(!address||typeof address==='string'||address.address!=='127.0.0.1'){server.close();throw Error('Invalid listener');}
  host='127.0.0.1:'+address.port;origin='http://'+host;
  return {origin,password,close:()=>new Promise<void>((resolve,reject)=>{server.close(e=>e?reject(e):resolve());server.closeAllConnections();})};
}
