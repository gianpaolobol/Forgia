import {windowsLogonTask} from '../server/remoteWindowsLogonPlan.ts';
try {
  const [sid,nodeExe,checkout,state,port,vault,keyDir]=process.argv.slice(2);
  if (process.argv.length!==9||!/^[0-9]+$/.test(port??'')) throw Error('Invalid arguments');
  process.stdout.write(windowsLogonTask({sid,nodeExe,checkout,state,port:Number(port),vault,keyDir}));
} catch {
  console.error('Logon task plan refused. See REMOTE_LOCAL_RUNBOOK.md.');
  process.exitCode=1;
}
