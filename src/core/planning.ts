import {validateSpec,type AppSpec} from './spec.ts';
export function planningInput(current:AppSpec,instruction:string):string {return JSON.stringify({current,instruction,preserveItems:true,request:'Proponi una specifica aggiornata senza eliminare i contenuti forniti.'});}
export function prepareProposal(current:AppSpec,input:unknown,allowDataChanges=false):{spec:AppSpec;changes:string[]}{
 const proposed=validateSpec(input);
 const spec=validateSpec({...proposed,kind:current.kind,quiz:current.items.length&&!allowDataChanges?current.quiz:proposed.quiz,items:current.items.length&&!allowDataChanges?current.items:proposed.items});
 const changes:string[]=[];
 if(spec.name!==current.name)changes.push(`Nome: ${current.name||'da definire'} → ${spec.name}`);
 if(spec.idea!==current.idea)changes.push('Descrizione aggiornata');
 if(JSON.stringify(spec.items)!==JSON.stringify(current.items))changes.push(`Contenuti: ${current.items.length} → ${spec.items.length} schede`);
 if(!changes.length)changes.push('Nessuna modifica ai dati del progetto');
 return {spec,changes};
}
