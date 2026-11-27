import type {JobRecovery} from './jobRecovery.ts';

export const localWebOrigin = 'http://127.0.0.1:8787';
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
export type LocalWebAuth = {session:string; headers:Record<string,string>};

// Credentials are deliberately not part of the persisted workspace.
export function localWebAuth(origin:string|undefined, account:string, code:string):LocalWebAuth|undefined {
 if(!account && !code)return;
 if(origin!==localWebOrigin || !uuid.test(account) || !/^[a-f0-9]{64}$/.test(code))throw Error('Inserisci UUID account e codice locale validi.');
 return {session:account,headers:{Authorization:'Bearer '+code,'X-Forgia-Require-Auth':'1'}};
}

export function verifyLocalWebMode(data:unknown,auth:LocalWebAuth|undefined){
 if(!data || typeof data!=='object')throw Error('Risposta gateway non valida.');
 const mode=data as Record<string,unknown>;
 if(auth ? mode.durableAuthorizationRequired!==true || mode.durableSession!==auth.session
   : mode.durableAuthorizationRequired===true)throw Error('Modalità o account gateway non corrispondente. Nessun invio.');
}

export function verifyLocalWebRecovery(job:JobRecovery|undefined,auth:LocalWebAuth|undefined){
 if(!job || job.origin!==localWebOrigin)return;
 if(Boolean(job.protectedLocal)!==Boolean(auth) || (auth && job.session!==auth.session))
  throw Error('Ripristina le autorizzazioni originali della ricevuta. Nessun reinvio.');
}
