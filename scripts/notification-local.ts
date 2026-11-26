import {setTimeout as delay} from 'node:timers/promises';
import {openNotificationLocal,NotificationLocalRuntime} from '../server/notificationLocalRuntime.ts';

const stop=new AbortController();
process.once('SIGINT',()=>stop.abort());process.once('SIGTERM',()=>stop.abort());
async function eventInput(){
  if(process.stdin.isTTY)throw Error('JSON pipe required');
  const chunks:Buffer[]=[];let size=0;
  for await(const chunk of process.stdin){const b=Buffer.from(chunk);size+=b.length;
    if(size>16384)throw Error('Event too large');chunks.push(b);}
  return JSON.parse(Buffer.concat(chunks).toString('utf8')) as unknown;
}
async function main(args:string[]){
  const [cmd,dir,owner,project,a,b]=args;
  if(cmd==='init'&&args.length===2){openNotificationLocal(dir,true).close();return;}
  if(!dir||!owner||!project)throw Error('Missing scope');
  const valid=(['publish','inbox','unread','tick','watch'].includes(cmd)&&args.length===4)||
    (['schedule','revoke'].includes(cmd)&&args.length===5)||(cmd==='read'&&args.length===6);
  if(!valid)throw Error('Invalid command');
  const db=openNotificationLocal(dir);
  try{
    const hub=new NotificationLocalRuntime(db,owner,project);
    switch(cmd){
      case 'publish':console.log(JSON.stringify(hub.publish(await eventInput())));break;
      case 'inbox':case 'unread':console.log(JSON.stringify(hub.snapshot(cmd==='unread')));break;
      case 'read':console.log(JSON.stringify({read:hub.markRead(a,b)}));break;
      case 'schedule':
        if(a!=='off'&&!/^[0-9]{1,4}$/.test(a))throw Error('Invalid minute');
        hub.schedule(a==='off'?null:Number(a));break;
      case 'revoke':
        if(a!=='email'&&a!=='telegram'&&a!=='push')throw Error('Invalid channel');
        hub.revoke(a);break;
      case 'tick':console.log(JSON.stringify(hub.tick()));break;
      case 'watch':
        // No automatic external delivery or logging of private event data.
        while(!stop.signal.aborted){
          hub.tick();
          try{await delay(30_000,undefined,{signal:stop.signal});}
          catch(e){if(!stop.signal.aborted)throw e;}
        }
    }
  }finally{db.close();}
}
main(process.argv.slice(2)).catch(()=>{
  console.error('Notification runtime refused or failed. See local runbook.');
  process.exitCode=1;
});
