import {validateSpec,text,type Project,type AppSpec} from './spec.ts';
export function newProject(id:string,spec:AppSpec):Project {
 const valid=validateSpec(spec);return {id,spec:valid,revisions:[{id:'r1',createdAt:new Date().toISOString(),instruction:'Prima bozza',spec:valid}]};
}
export function reviseProject(project:Project,instruction:string,next:AppSpec):Project {
 const valid=validateSpec(next),note=text(instruction,'Modifica richiesta',2000);
 const history=project.revisions??newProject(project.id,project.spec).revisions!;
 if(history.length>=50)throw Error('Limite di 50 versioni raggiunto. Esporta il progetto prima di proseguire.');
 return {id:project.id,spec:valid,revisions:[...history,{id:`r${history.length+1}`,createdAt:new Date().toISOString(),instruction:note,spec:valid}]};
}
export function restoreRevision(project:Project,id:string):Project {
 const found=project.revisions?.find(r=>r.id===id);if(!found)throw Error('Versione non trovata.');return reviseProject(project,`Ripristino della versione ${id}`,found.spec);
}
