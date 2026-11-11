export type AppKind = 'catalog' | 'tracker' | 'community';
export interface CatalogItem {name:string; category:string; color:string}
export interface AppSpec {name:string; idea:string; kind:AppKind; quiz:boolean; items:CatalogItem[]}
export interface Revision {id:string;createdAt:string;instruction:string;spec:AppSpec}
export interface Project {id:string; spec:AppSpec;revisions?:Revision[]}
export function text(value:unknown,label:string,max:number):string {
 if(typeof value!=='string'||!value.trim()||value.trim().length>max||/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/u.test(value))throw Error(`${label}: inserisci un testo da 1 a ${max} caratteri.`);
 return value.trim();
}
export function validateSpec(input:unknown):AppSpec {
 if(!input||typeof input!=='object'||Array.isArray(input))throw Error('Specifica non valida.');
 const s=input as Record<string,unknown>;
 const name=text(s.name,'Nome',80),idea=text(s.idea,'Idea',4000);
 if(!['catalog','tracker','community'].includes(String(s.kind)))throw Error('Tipo di app non supportato.');
 if(typeof s.quiz!=='boolean')throw Error('Quiz: valore non valido.');
 if(!Array.isArray(s.items)||s.items.length>(100)||s.kind==='catalog'&&s.items.length<1)throw Error('Servono da 1 a 100 schede.');
 if(s.kind!=='catalog'&&s.quiz)throw Error('Quiz disponibile soltanto per cataloghi.');
 const items=s.items.map((v:unknown)=>{
  if(!v||typeof v!=='object')throw Error('Scheda non valida.');
  const i=v as Record<string,unknown>;
  return {name:text(i.name,'Nome scheda',100),category:text(i.category,'Categoria',60),color:typeof i.color==='string'?i.color.trim():''};
 });
 if(new Set(items.map(i=>i.name.toLocaleLowerCase('it'))).size!==items.length)throw Error('Nomi scheda duplicati.');
 if(items.some(i=>i.color.length>60))throw Error('Colore troppo lungo.');
 if(s.quiz&&(items.some(i=>!i.color)||new Set(items.map(i=>i.color)).size<4))throw Error('Il quiz richiede un colore per ogni scheda e almeno quattro colori diversi.');
 return {name,idea,kind:s.kind as AppKind,quiz:s.quiz,items};
}
export function parseItems(value:string):CatalogItem[] {
 if(value.trim().startsWith('[')){const parsed=JSON.parse(value);if(!Array.isArray(parsed))throw Error('Elenco schede non valido.');return parsed;}
 return value.split('\n').filter(l=>l.trim()).map(line=>{
  const parts=line.split('|').map(p=>p.trim());
  if(parts.length<2||parts.length>3)throw Error('Usa una riga per scheda: nome | categoria | colore opzionale.');
  return {name:parts[0],category:parts[1],color:parts[2]??''};
 });
}
export function formatItems(items:CatalogItem[]):string {
 if(items.some(i=>[i.name,i.category,i.color].some(v=>/[|\r\n]/.test(v))))return JSON.stringify(items,null,2);
 return items.map(i=>`${i.name} | ${i.category}${i.color?' | '+i.color:''}`).join('\n');
}
export const EXAMPLE_ITEMS='Alba | A | blu\nBrina | A | verde\nCorda | B | rosso\nDuna | B | giallo\nEdera | C | viola\nFilo | C | bianco';
export function slug(name:string):string {const s=name.normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase().replace(/[^a-z0-9]+/g,'-').replace(/^-|-$/g,'').slice(0,45);return /^[a-z]/.test(s)?s:`app-${s||'progetto'}`;}
