import {isAbsolute,relative,resolve,sep} from 'node:path';
import {openRemoteLocalDb} from './remoteLocalRuntime.ts';
import {RemoteCredentialVault,type VaultRole} from './remoteCredentialVault.ts';
import {RemoteNodeStatus} from './remoteNodeStatus.ts';

// The OS-specific CLI verifies DPAPI and private directories first. This
// dependency-free synchronous primitive also supports synthetic local tests.
// Never use shared/network storage. Control and vault are separate databases:
// control rollback on delivery error is atomic, cross-file crash recovery is not.
export function provisionRemoteCredential(state:string,vaultDir:string,node:string,role:VaultRole,ttlMs:number,key:string){
  if(!isAbsolute(state)||!isAbsolute(vaultDir)||!/^[a-f0-9]{64}$/.test(key))
    throw Error('Invalid provisioning configuration');
  const canonical=(p:string)=>process.platform==='win32'?resolve(p).toLowerCase():resolve(p);
  const a=canonical(state),b=canonical(vaultDir);
  const within=(from:string,to:string)=>{
    const r=relative(from,to);
    return r===''||(!isAbsolute(r)&&r!=='..'&&!r.startsWith('..'+sep));
  };
  if(within(a,b)||within(b,a))throw Error('Separate local directories required');
  const control=openRemoteLocalDb(state,'control');
  try{
    const vaultDb=openRemoteLocalDb(vaultDir,'vault');
    try{
      const vault=new RemoteCredentialVault(vaultDb);
      const store=new RemoteNodeStatus(control);
      return store.issueToLocalVault(node,role,ttlMs,token=>vault.import(role,key,token));
    }finally{vaultDb.close();}
  }finally{control.close();}
}
