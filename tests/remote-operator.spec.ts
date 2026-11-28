import {test, expect} from '@playwright/test';
import {createServer, request, type Server} from 'node:http';
import {DatabaseSync} from 'node:sqlite';
import {RemoteNodeStatus} from '../server/remoteNodeStatus.ts';
import {listenPrivateOperator} from '../server/remotePrivateOperator.ts';

// Real Chromium and real Forgia HTTP/SQLite, with a test-only loopback proxy.
// No external DNS, TLS, Tailscale, device identity, credentials or ports exposed.
const host = 'workstation.example.ts.net', login = 'operator@example.invalid';
function port(server: Server): number {
  const a = server.address();
  if (!a || typeof a === 'string' || a.address !== '127.0.0.1') throw Error('fixture bind');
  return a.port;
}
async function stop(server: Server) {
  await new Promise<void>((resolve,reject) => {
    server.close(error => error ? reject(error) : resolve());
    server.closeAllConnections();
  });
}
async function fixture() {
  const db = new DatabaseSync(':memory:');
  const store = new RemoteNodeStatus(db);
  store.register('pc');
  const node = store.issue('pc','node',120_000), op = store.issue('pc','operator',120_000);
  store.heartbeat(node.token,1);
  let backend: Server | undefined, proxy: Server | undefined, posts=0, drop=false;
  try {
    const target = await listenPrivateOperator(store,{host,login,port:0});
    backend=target;
    const bridge=createServer((req,res)=>{
      // The browser talks to a secure-context loopback HTTP origin. Translate
      // only its exact Origin for the synthetic HTTPS proxy contract; preserve
      // actual browser Fetch Metadata and authorization, never invent them.
      const origin='http://127.0.0.1:'+port(bridge);
      const headers: Record<string,string> = {
        Host:host,'Tailscale-User-Login':login,'X-Forwarded-Proto':'https',
      };
      for (const name of ['authorization','origin','sec-fetch-site','idempotency-key','content-length','transfer-encoding']) {
        const value=req.headers[name];
        if(typeof value==='string')headers[name]=name==='origin'&&value===origin?'https://'+host:value;
      }
      const submission=req.method==='POST'&&req.url==='/v1/snapshots';
      if(submission)posts++;
      const upstream=request({hostname:'127.0.0.1',port:port(target),method:req.method,path:req.url,headers,agent:false},reply=>{
        const chunks:Buffer[]=[];
        reply.on('data',(chunk:Buffer)=>chunks.push(chunk));
        reply.on('error',()=>res.destroy());
        reply.on('end',()=>{
          const body=Buffer.concat(chunks);
          const responseHeaders={...reply.headers,connection:'close'};
          delete responseHeaders['transfer-encoding'];
          // Simulate a lost response AFTER the backend accepted the request.
          // A truncated HTTP body makes fetch/body reading fail in Chromium.
          if(submission&&drop&&reply.statusCode===202){
            drop=false;
            res.writeHead(202,{...responseHeaders,'content-length':String(body.length+10)});
            res.end(body.subarray(0,1));return;
          }
          res.writeHead(reply.statusCode??502,{...responseHeaders,'content-length':String(body.length)});
          res.end(body);
        });
      });
      upstream.setTimeout(5000,()=>upstream.destroy());
      upstream.on('error',()=>{if(!res.headersSent)res.writeHead(502);res.end();});
      req.on('error',()=>upstream.destroy());
      req.pipe(upstream);
    });
    proxy=bridge;
    await new Promise<void>((resolve,reject)=>{
      bridge.once('error',reject);
      bridge.listen(0,'127.0.0.1',()=>{bridge.removeListener('error',reject);resolve();});
    });
    return {url:'http://127.0.0.1:'+port(bridge)+'/operator',store,node,op,
      dropNext:()=>{drop=true;},posts:()=>posts,async close(){
        try{await stop(bridge);}finally{try{await stop(target);}finally{db.close();}}
      }};
  } catch(error) {
    try{if(proxy?.listening)await stop(proxy);}finally{try{if(backend)await stop(backend);}finally{db.close();}}
    throw error;
  }
}

test('RC61 mobile Chromium: lost diagnostic response, original key recovery, completion without replay',async({page})=>{
  const f=await fixture();
  try{
    await page.setViewportSize({width:375,height:812});
    await page.goto(f.url);
    await expect(page.getByRole('heading',{name:'Forgia — stato privato'})).toBeVisible();
    expect(await page.evaluate(()=>window.isSecureContext)).toBe(true);
    const grant=page.getByLabel('Grant operatore'), key=page.getByLabel('Chiave richiesta');
    const result=page.locator('#snapshot-result'), receipt=page.getByLabel('ID ricevuta');
    await page.getByRole('button',{name:'Genera chiave'}).click();
    const original=await key.inputValue();
    expect(original).toMatch(/^[a-f0-9-]{36}$/);
    await grant.fill(f.op.token);
    f.dropNext();
    await page.getByRole('button',{name:'Richiedi ricevuta'}).click();
    await expect(result).toContainText('Esito non confermato');
    await expect(grant).toHaveValue('');
    expect(f.posts()).toBe(1);
    const saved=f.store.findSnapshot(f.op.token,original).id;
    expect(saved).toBeTruthy();
    await page.reload();
    await expect(grant).toHaveValue('');
    await key.fill(original);await grant.fill(f.op.token);
    await page.getByRole('button',{name:'Cerca ricevuta (senza reinvio)'}).click();
    await expect(result).toContainText('Ricevuta ritrovata');
    await expect(receipt).toHaveValue(saved!);
    await expect(grant).toHaveValue('');
    await grant.fill(f.op.token);
    await page.getByRole('button',{name:'Leggi ricevuta'}).click();
    await expect(result).toHaveText('Stato: in attesa');
    f.store.heartbeat(f.node.token,2);
    await grant.fill(f.op.token);
    await page.getByRole('button',{name:'Leggi ricevuta'}).click();
    await expect(result).toHaveText('Stato: completata');
    expect(f.posts()).toBe(1);
    expect(await page.evaluate(()=>({local:localStorage.length,session:sessionStorage.length,cookie:document.cookie}))).toEqual({local:0,session:0,cookie:''});
  }finally{await f.close();}
});

test('RC62 mobile Chromium: live grant revocation is not reported as node offline',async({page})=>{
  const f=await fixture();
  try{
    await page.setViewportSize({width:375,height:812});
    await page.goto(f.url);
    const grant=page.getByLabel('Grant operatore'), status=page.locator('#result');
    await grant.fill(f.op.token);
    await page.getByRole('button',{name:'Verifica stato'}).click();
    await expect(status).toContainText('pc: online');
    await expect(grant).toHaveValue('');
    expect(f.store.revoke(f.op.id)).toBe(true);
    await grant.fill(f.op.token);
    await page.getByRole('button',{name:'Verifica stato'}).click();
    await expect(status).toHaveText('Stato non disponibile. Verifica autorizzazione e servizio.');
    await expect(grant).toHaveValue('');
    expect(f.posts()).toBe(0);
    expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
  }finally{await f.close();}
});
