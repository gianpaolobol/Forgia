export interface Grant {service:string;scopes:string[];expiresAt:string;credentialRef:string;revoked:boolean}
export interface Action {service:string;scope:string;costCents:number}
export function authorize(grant:Grant,action:Action,now=new Date()):{allowed:boolean;reason:string}{
 if(!Number.isSafeInteger(action.costCents)||action.costCents!==0||action.scope==='purchase')return {allowed:false,reason:'Budget zero: acquisti e costi non autorizzati.'};
 if(!grant||grant.revoked||!Number.isFinite(Date.parse(grant.expiresAt))||Date.parse(grant.expiresAt)<=now.getTime())return {allowed:false,reason:'Delega assente, revocata o scaduta.'};
 if(grant.service!==action.service||!grant.scopes.includes(action.scope)||!grant.credentialRef?.startsWith('vault:'))return {allowed:false,reason:'Permesso o collegamento mancante.'};
 return {allowed:true,reason:'Azione ammessa dalla delega.'};
}
export function connectionState(input:{mfaRequired:boolean;sessionVerified:boolean}):'user_presence_required'|'connected'|'disconnected'{
 return input.mfaRequired?'user_presence_required':input.sessionVerified?'connected':'disconnected';
}
