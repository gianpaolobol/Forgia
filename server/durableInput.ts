import {inputPayload} from './legacyJobMigration.ts';
import {localProvider,validateModel} from './modelRegistry.ts';

export type DurableInput = {idea:string;provider:string;consent:boolean;context:{kind:'catalog'|'tracker'|'community';phase:'draft'|'revision'};expectedModel?:string;authorizationGrant?:string};

// Keep jobs.v1 frozen. The durable format adds one optional, canonical field.
export function durableInputPayload(value:unknown):string {
 if(!value||typeof value!=='object'||Array.isArray(value))throw Error('Payload durevole non valido.');
 const {expectedModel,authorizationGrant,...legacy}=value as Record<string,unknown>;
 const canonical=inputPayload(legacy);
 const input=JSON.parse(canonical) as DurableInput;
 if(Object.hasOwn(value,'expectedModel')){
  if(!localProvider(input.provider)||input.consent!==false)throw Error('Pin modello solo per provider locale esplicito.');
  validateModel(input.provider,expectedModel);
  input.expectedModel=expectedModel as string;
 }
 if(Object.hasOwn(value,'authorizationGrant')){
  if(typeof authorizationGrant!=='string'||!/^[a-f0-9]{64}$/.test(authorizationGrant)||input.consent!==false)throw Error('Grant durevole non valido.');
  input.authorizationGrant=authorizationGrant;
 }
 return JSON.stringify(input);
}
export function durableModelAllowed(input:DurableInput,modelFor?:(provider:string)=>string|undefined):boolean {
 if(!['auto','local','llamacpp'].includes(input.provider))return false;
 if(input.expectedModel===undefined)return true;
 return localProvider(input.provider)&&modelFor?.(input.provider)===input.expectedModel;
}
