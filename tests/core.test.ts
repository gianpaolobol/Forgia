import test from 'node:test';
import assert from 'node:assert/strict';
import { writeFile, mkdtemp, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
const domain = await import('../src/core/spec.ts').catch(() => ({} as any));
const generator = await import('../src/core/generator.ts').catch(() => ({} as any));
const storage = await import('../src/core/storage.ts').catch(() => ({} as any));
export const spec = {name:'Atlante Demo',idea:'Un catalogo offline di sei oggetti inventati',kind:'catalog',quiz:true,items:[
 {name:'Alba',category:'A',color:'blu'},{name:'Brina',category:'A',color:'verde'},
 {name:'Corda',category:'B',color:'rosso'},{name:'Duna',category:'B',color:'giallo'},
 {name:'Edera',category:'C',color:'viola'},{name:'Filo',category:'C',color:'bianco'}]};
function required(object:any, name:string){assert.equal(typeof object[name],'function',`${name} deve essere implementato`);return object[name];}
test('il dataset rimane esattamente quello del cliente',()=>{
 const s=required(domain,'validateSpec')(spec);assert.equal(s.items.length,6);assert.deepEqual(s.items.map((i:any)=>i.name),spec.items.map(i=>i.name));
});
test('rifiuta dati mancanti, tipi errati e quiz con meno di quattro colori',()=>{
 const validate=required(domain,'validateSpec');
 for(const s of [{...spec,items:[]},{...spec,name:''},{...spec,quiz:'false'},{...spec,items:spec.items.map(i=>({...i,color:'blu'}))}])assert.throws(()=>validate(s));
});
test('nomi duplicati sono ambigui e vengono rifiutati',()=>{assert.throws(()=>required(domain,'validateSpec')({...spec,items:[...spec.items,spec.items[0]]}));});
test('separatore e ritorno a capo nei nomi non cambiano i dati durante una revisione',()=>{
 const original=[{name:'A | B',category:'C\nD',color:''}];const format=required(domain,'formatItems');assert.deepEqual(domain.parseItems(format(original)),original);
});
test('un gestionale non diventa un catalogo con login simulato',()=>{assert.throws(()=>required(generator,'generateProject')({...spec,kind:'tracker',quiz:false}),/supportat/i);});
test('testo ostile rimane dato JSON, nessun percorso controllato dal cliente',()=>{
 const result=required(generator,'generateProject')({...spec,name:'../../Ciao " mondo',items:spec.items.map((i,n)=>n===0?{...i,name:'</script> ${process.env.SECRET}'}:i)});
 assert.ok(Object.keys(result.files).every(p=>!p.includes('..')&&!p.startsWith('/')));
 const data=JSON.parse(result.files['src/catalog.json']);assert.equal(data.items[0].name,'</script> ${process.env.SECRET}');
 assert.match(JSON.parse(result.files['app.json']).expo.slug,/^[a-z][a-z0-9-]*$/);
});
test('export crea sorgenti Expo e nessuna attestazione di beta',()=>{
 const bundle=required(generator,'generateProject')(spec);assert.ok(bundle.files['App.tsx']);
 assert.equal(JSON.parse(bundle.files['src/catalog.json']).items.length,6);
 assert.equal(bundle.stage,'source_generated');assert.ok(bundle.pending.includes('physical_install'));
 assert.ok(!Object.values(bundle.files).some((s:any)=>/sk-proj-|gsk_/.test(String(s))));
});
test('il quiz esportato rifiuta risposte mancanti e calcola errori reali',async()=>{
 const b=required(generator,'generateProject')(spec);const dir=await mkdtemp(join(tmpdir(),'forgia-quiz-'));
 await writeFile(join(dir,'quiz.mjs'),b.files['src/quiz.js']);
 const {scoreQuiz}=await import('file://'+join(dir,'quiz.mjs'));
 assert.throws(()=>scoreQuiz(spec.items,{}),/rispond/i);
 const answers=Object.fromEntries(spec.items.map(i=>[i.name,i.color]));
 assert.deepEqual(scoreQuiz(spec.items,answers),{correct:6,total:6,errors:[]});
 answers.Alba='giallo';assert.deepEqual(scoreQuiz(spec.items,answers),{correct:5,total:6,errors:['Alba']});
});
class MemoryStorage {values=new Map<string,string>();fail=false;async getItem(k:string){return this.values.get(k)??null;}async setItem(k:string,v:string){if(this.fail)throw Error('disco pieno');this.values.set(k,v);}}
test('riapre progetti dopo una nuova istanza e conserva Unicode',async()=>{
 const kv=new MemoryStorage();const repo=required(storage,'createRepository')(kv);await repo.save([{id:'p1',spec:{...spec,name:'È un’idea 🌱'}}]);
 const loaded=await storage.createRepository(kv).load();assert.equal(loaded.projects[0].spec.name,'È un’idea 🌱');assert.equal(loaded.recovered,false);
});
test('una scrittura fallita non viene mostrata come salvataggio riuscito',async()=>{
 const kv=new MemoryStorage();const repo=required(storage,'createRepository')(kv);await repo.save([{id:'p1',spec}]);kv.fail=true;
 await assert.rejects(repo.save([{id:'p2',spec}]),/disco pieno/);kv.fail=false;assert.equal((await repo.load()).projects[0].id,'p1');
});
test('primario corrotto recupera ultima versione integra e lo dichiara',async()=>{
 const kv=new MemoryStorage();const repo=required(storage,'createRepository')(kv);await repo.save([{id:'p1',spec}]);await repo.save([{id:'p2',spec}]);
 kv.values.set('forgia.projects.v1','{corrotto');const r=await repo.load();assert.equal(r.recovered,true);assert.equal(r.projects[0].id,'p1');
});
test('se tutti i salvataggi sono corrotti blocca senza sovrascrivere',async()=>{
 const kv=new MemoryStorage();kv.values.set('forgia.projects.v1','{');const repo=required(storage,'createRepository')(kv);
 await assert.rejects(repo.load(),/recuper/i);await assert.rejects(repo.save([]),/recuper/i);assert.equal(kv.values.get('forgia.projects.v1'),'{');
});
test('riparazione interrotta non riscrive mai il backup integro',async()=>{
 const kv=new MemoryStorage();const repo=required(storage,'createRepository')(kv);await repo.save([{id:'p1',spec}]);await repo.save([{id:'p2',spec}]);kv.values.set('forgia.projects.v1','{');
 const original=kv.values.get('forgia.projects.v1.backup');const set=kv.setItem.bind(kv);kv.setItem=async(k,v)=>{if(k==='forgia.projects.v1.backup'){kv.values.set(k,'{');throw Error('interruzione backup');}kv.values.set(k,'{');throw Error('interruzione primario');};
 await assert.rejects(repo.save([{id:'p3',spec}]));assert.equal(kv.values.get('forgia.projects.v1.backup'),original);kv.setItem=set;assert.equal((await repo.load()).projects[0].id,'p1');
});
test('requisiti di gestionali e gruppi si salvano senza inventare schede',()=>{const validate=required(domain,'validateSpec');for(const kind of ['tracker','community'])assert.equal(validate({...spec,kind,quiz:false,items:[]}).items.length,0);});
