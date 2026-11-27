import {openRemotePrivateControl} from '../server/remoteLocalRuntime.ts';
import {RemoteNodeStatus} from '../server/remoteNodeStatus.ts';
import {listenPrivateOperator} from '../server/remotePrivateOperator.ts';

// Foreground local opt-in only. Never launches or modifies an identity proxy.
async function main(){
  const [ack,state,rawPort,host,login,...extra]=process.argv.slice(2);
  if(!process.stdin.isTTY||!process.stdout.isTTY||ack!=='--ack-private-proxy'||
     !state||!rawPort||!host||!login||extra.length||!/^[0-9]{1,5}$/.test(rawPort))
    throw Error('Local interactive configuration required');
  const port=Number(rawPort);
  if(port<1||port>65535||port===8787)throw Error('Invalid port');
  const stop=new AbortController();
  const abort=()=>stop.abort();
  process.once('SIGINT',abort);process.once('SIGTERM',abort);
  const db=openRemotePrivateControl(state);
  try{
    const server=await listenPrivateOperator(new RemoteNodeStatus(db),{port,host,login});
    try{
      console.log('Private operator backend ready on loopback only; proxy not configured.');
      if(!stop.signal.aborted)await new Promise<void>(resolve=>stop.signal.addEventListener('abort',()=>resolve(),{once:true}));
    }finally{await new Promise<void>((resolve,reject)=>server.close(error=>error?reject(error):resolve()));}
  }finally{
    db.close();process.removeListener('SIGINT',abort);process.removeListener('SIGTERM',abort);
  }
}
main().catch(()=>{console.error('Private operator backend refused or failed. See local runbook.');process.exitCode=1;});
