import test from 'node:test';
import assert from 'node:assert/strict';
const mod=await import('../server/gateway.ts').catch(()=>({} as any));
const adapters=await import('../server/providers.ts').catch(()=>({} as any));
const sample={name:'Nuova app',idea:'Catalogo per la biblioteca',kind:'catalog',quiz:false,items:[{name:'Libro',category:'Narrativa',color:''}]};
class Memory {data=new Map<string,string>();async getItem(k:string){return this.data.get(k)??null;}async setItem(k:string,v:string){this.data.set(k,v);}}
function gateway(store=new Memory(),limit=2){assert.equal(typeof mod.createGateway,'function','Gateway da implementare');return mod.createGateway(store,{dailyLimit:limit});}
function provider(overrides:Record<string,unknown>={}){return {id:'local',model:'test-local',mode:'local',eligible:async()=>true,complete:async()=>JSON.stringify(sample),...overrides};}
test('cloud senza consenso non riceve prompt',async()=>{let calls=0;const g=gateway();await assert.rejects(g.plan('Catalogo libri',provider({id:'groq',mode:'free',complete:async()=>{calls++;return JSON.stringify(sample);}}),false),/consenso/i);assert.equal(calls,0);});
test('provider pagato e sconosciuto bloccati prima della rete',async()=>{const g=gateway();for(const p of [provider({mode:'paid'}),provider({id:'unknown'})])await assert.rejects(g.plan('Catalogo libri',p,true),/gratuit|supportat/i);});
test('cache validata sopravvive a riavvio senza nuova chiamata',async()=>{const s=new Memory();let n=0;const p=provider({complete:async()=>{n++;return JSON.stringify(sample);}});await gateway(s).plan('Catalogo libri',p,false);const r=await gateway(s).plan('Catalogo libri',p,false);assert.equal(n,1);assert.equal(r.cached,true);assert.equal(r.spec.name,'Nuova app');});
test('due richieste concorrenti non superano una quota unica',async()=>{const s=new Memory();const g=gateway(s,1);let n=0;const p=provider({complete:async()=>{n++;return JSON.stringify(sample);}});const r=await Promise.allSettled([g.plan('Prima idea',p,false),g.plan('Seconda idea',p,false)]);assert.equal(r.filter(v=>v.status==='fulfilled').length,1);assert.equal(n,1);await assert.rejects(gateway(s,1).plan('Terza idea',p,false),/quota/i);});
test('429 è una sospensione senza cache di successo o ripiego pagato',async()=>{const g=gateway();await assert.rejects(g.plan('Catalogo libri',provider({complete:async()=>{throw Object.assign(Error('Quota remota'),{status:429});}}),false),(e:any)=>e.status===429);});
test('JSON incompleto non viene salvato come progetto riuscito',async()=>{const g=gateway();await assert.rejects(g.plan('Catalogo libri',provider({complete:async()=>'{}'}),false));});
test('stato quota corrotto blocca il gateway senza azzerare contatori',async()=>{const s=new Memory();s.data.set('gateway.v1','{');await assert.rejects(gateway(s).plan('Catalogo libri',provider(),false),/corrotto/i);assert.equal(s.data.get('gateway.v1'),'{');});
test('contatori JSON array non possono azzerare la quota al riavvio',async()=>{const s=new Memory();s.data.set('gateway.v1',JSON.stringify({version:1,day:new Date().toISOString().slice(0,10),counts:[],cache:{}}));let n=0;await assert.rejects(gateway(s,1).plan('Idea',provider({complete:async()=>{n++;return JSON.stringify(sample);}}),false),/corrotto/i);assert.equal(n,0);});
test('Ollama cloud e Groq senza attestazione Free non partono',async()=>{assert.equal(typeof adapters.createProvider,'function');for(const p of [{id:'local',model:'qwen3-coder:cloud'},{id:'groq',model:'test',apiKey:'test-only'}])await assert.rejects(async()=>{const a=adapters.createProvider(p);await a.eligible();},/cloud|Free|locale/i);});
test('OpenRouter rifiuta prezzi sconosciuti o non zero e modelli senza :free',async()=>{
 assert.equal(typeof adapters.createProvider,'function');
 for(const model of ['paid/model','model:free']){
  let completionCalls=0;
  const f=async(url:string)=>{if(url.includes('chat/completions'))completionCalls++;return new Response(JSON.stringify({data:[{id:'model:free',pricing:{prompt:'0.1',completion:'0'}}]}));};
  await assert.rejects(async()=>{const p=adapters.createProvider({id:'openrouter',model,apiKey:'test-only'},f);await p.eligible();});assert.equal(completionCalls,0);
 }
});
test('prezzi vuoti e spazi non sono una prova di gratuità',async()=>{assert.equal(typeof adapters.createProvider,'function');for(const price of ['', '   ']){const p=adapters.createProvider({id:'openrouter',model:'model:free',apiKey:'test-only'},async()=>new Response(JSON.stringify({data:[{id:'model:free',pricing:{prompt:price,completion:price}}]})));await assert.rejects(p.eligible(),/gratuit/i);}});
test('adapter Groq invia il protocollo previsto e interpreta il risultato',async()=>{
 assert.equal(typeof adapters.createProvider,'function');let seen=false;
 const f=async(url:string,init:RequestInit)=>{assert.equal(url,'https://api.groq.com/openai/v1/chat/completions');const body=JSON.parse(init.body as string);assert.equal(body.model,'example-free-model');assert.equal(body.messages[0].role,'system');seen=true;return new Response(JSON.stringify({choices:[{message:{content:JSON.stringify(sample)}}]}));};
 const p=adapters.createProvider({id:'groq',model:'example-free-model',apiKey:'test-only',freePlanConfirmed:true},f);await p.eligible();assert.equal(JSON.parse(await p.complete('idea',new AbortController().signal)).name,'Nuova app');assert.equal(seen,true);
});
test('adapter Ollama usa solo loopback e rifiuta risposta incompleta',async()=>{
 assert.equal(typeof adapters.createProvider,'function');
 const p=adapters.createProvider({id:'local',model:'local-model'},async(url:string,init:RequestInit)=>{assert.equal(url,'http://127.0.0.1:11434/api/chat');assert.equal(JSON.parse(init.body as string).stream,false);return new Response(JSON.stringify({done:false,message:{content:'{}'}}));});await p.eligible();await assert.rejects(p.complete('idea',new AbortController().signal),/incompleta/i);
});
