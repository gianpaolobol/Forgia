import {validateModel} from './modelRegistry.ts';
export type ExplicitCloudPolicy=Readonly<{session:string;model:string}>;
export function explicitCloudPolicy(session:string|undefined, state:{protectedLedger:boolean;model:string|undefined;hasKey:boolean}):ExplicitCloudPolicy|undefined{
 if(session===undefined)return undefined;
 if(!/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/.test(session)||!state.protectedLedger||!state.hasKey)throw Error('Cloud esplicito richiede sessione, archivio protetto e configurazione gratuita.');
 validateModel('openrouter',state.model);
 if(!/^[a-z0-9._-]+\/[a-z0-9._-]+:free$/i.test(state.model))throw Error('Modello OpenRouter :free esplicito richiesto.');
 return Object.freeze({session,model:state.model});
}
export function cloudSessionAllowed(policy:ExplicitCloudPolicy|undefined,session:string|undefined):boolean{
 return !!policy&&policy.session===session;
}
