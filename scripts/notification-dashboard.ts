import {openNotificationLocal,NotificationLocalRuntime} from '../server/notificationLocalRuntime.ts';
import {startNotificationDashboard} from '../server/notificationLocalDashboard.ts';

async function main(){
  const [dir,owner,project]=process.argv.slice(2);
  if(process.argv.length!==5||!dir||!owner||!project||!process.stdin.isTTY||!process.stderr.isTTY)
    throw Error('Interactive local terminal required');
  const db=openNotificationLocal(dir);
  try{
    const runtime=new NotificationLocalRuntime(db,owner,project);
    const dashboard=await startNotificationDashboard(runtime,8790);
    // Ephemeral password only on the private interactive terminal; never in URL or DB.
    console.error('Apri '+dashboard.origin+' sullo stesso computer. Utente: operator. Password temporanea: '+dashboard.password);
    await new Promise<void>(resolve=>{process.once('SIGINT',resolve);process.once('SIGTERM',resolve);});
    await dashboard.close();
  }finally{db.close();}
}
main().catch(()=>{console.error('Pannello locale non disponibile. Consultare il runbook.');process.exitCode=1;});
