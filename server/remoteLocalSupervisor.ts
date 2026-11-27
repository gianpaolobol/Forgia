import {setTimeout as delay} from 'node:timers/promises';
import {openRemoteLocalDb,openRemotePrivateControl,startRemoteLocalHost} from './remoteLocalRuntime.ts';
import {RemoteHeartbeatAgent} from './remoteHeartbeatAgent.ts';

export type LocalSupervisorOutcome='stopped'|'denied'|'unavailable';

// A single foreground process owns both the loopback listener and its agent.
// Never connects to a pre-existing listener. Caller provisions the grant first.
export async function runRemoteLocalSupervisor(
  directory:string,port:number,token:string,signal:AbortSignal,
  onReady:(port:number)=>void=()=>{},
):Promise<LocalSupervisorOutcome> {
  if (!Number.isSafeInteger(port)||port<0||port>65535||port===8787||
      !/^[a-f0-9]{64}$/.test(token)) throw Error('Invalid local supervisor configuration');
  if (signal.aborted) return 'stopped';
  // A supervisor is a runtime entry point, not an administrative bootstrap.
  openRemotePrivateControl(directory).close();
  const host=await startRemoteLocalHost(directory,port);
  try {
    if (signal.aborted) return 'stopped';
    const address=host.server.address();
    if (!address||typeof address==='string'||address.address!=='127.0.0.1')
      throw Error('Invalid local supervisor listener');
    const db=openRemoteLocalDb(directory,'agent');
    try {
      const agent=new RemoteHeartbeatAgent(db,address.port,token);
      try {
        let ready=false;
        while (!signal.aborted) {
          const outcome=await agent.pulse();
          if (signal.aborted) return 'stopped';
          // No automatic relaunch, no fallback grant and no repeated failure.
          if (outcome!=='accepted') return outcome;
          if (!ready) { onReady(address.port); ready=true; }
          try { await delay(30_000,undefined,{signal}); }
          catch (error) { if (!signal.aborted) throw error; }
        }
        return 'stopped';
      } finally { await agent.stop(); }
    } finally { db.close(); }
  } finally { await host.close(); }
}
