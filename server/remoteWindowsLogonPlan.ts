import {win32 as p} from 'node:path';

type LogonPlan = {sid:string;nodeExe:string;checkout:string;state:string;port:number;vault:string;keyDir:string};
function localPath(value:string):string {
  // No UNC, device path, shell substitutions, quotes, ADS, dot segments,
  // ambiguous trailing spaces/dots, or Windows reserved filenames.
  if (!/^[A-Za-z]:\\[^\\]+(?:\\[^\\]+)*$/.test(value) ||
      /[<>"|?*%:\x00-\x1f/]/.test(value.slice(2)) ||
      value.slice(3).split('\\').some(part=>/[ .]$/.test(part) ||
        /^(?:CON|PRN|AUX|NUL|COM[1-9¹²³]|LPT[1-9¹²³])(?:\.|$)/i.test(part)))
    throw Error('Unambiguous local Windows path required');
  return value;
}
function separate(a:string,b:string) {
  a=a.toLowerCase(); b=b.toLowerCase();
  if (a===b||a.startsWith(b+'\\')||b.startsWith(a+'\\'))
    throw Error('Separate private paths required');
}
function xml(value:string) {
  return value.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;')
    .replace(/"/g,'&quot;').replace(/'/g,'&apos;');
}
// Pure, offline plan only: no scheduler mutation, shell, password, token,
// privilege elevation, background service, network or automatic restart.
export function windowsLogonTask(input:LogonPlan):string {
  const {sid,port}=input;
  if (!/^S-1-(?:5-21-\d{1,10}-\d{1,10}-\d{1,10}-\d{1,10}|12-1-\d{1,10}-\d{1,10}-\d{1,10}-\d{1,10})$/.test(sid) ||
      !Number.isSafeInteger(port)||port<1024||port>65535||port===8787)
    throw Error('Invalid interactive user or port');
  const node=localPath(input.nodeExe),checkout=localPath(input.checkout);
  const state=localPath(input.state),vault=localPath(input.vault),key=localPath(input.keyDir);
  if (p.basename(node).toLowerCase()!=='node.exe') throw Error('Explicit Node executable required');
  const dirs=[checkout,state,vault,key];
  for(let i=0;i<dirs.length;i++) for(let j=i+1;j<dirs.length;j++) separate(dirs[i],dirs[j]);
  const args=['--experimental-strip-types','"'+p.join(checkout,'scripts','remote-local.ts')+'"',
    'run-os','"'+state+'"',String(port),'"'+vault+'"','"'+key+'"'].join(' ');
  return '<?xml version="1.0" encoding="UTF-8"?>\n'+
    '<Task version="1.2" xmlns="http://schemas.microsoft.com/windows/2004/02/mit/task">\n'+
    '<RegistrationInfo><Description>Forgia local authorized heartbeat only</Description></RegistrationInfo>\n'+
    '<Triggers><LogonTrigger><Enabled>true</Enabled><UserId>'+xml(sid)+'</UserId></LogonTrigger></Triggers>\n'+
    '<Principals><Principal id="Operator"><UserId>'+xml(sid)+'</UserId><LogonType>InteractiveToken</LogonType><RunLevel>LeastPrivilege</RunLevel></Principal></Principals>\n'+
    '<Settings><MultipleInstancesPolicy>IgnoreNew</MultipleInstancesPolicy><DisallowStartIfOnBatteries>true</DisallowStartIfOnBatteries>'+
    '<StopIfGoingOnBatteries>true</StopIfGoingOnBatteries><StartWhenAvailable>false</StartWhenAvailable>'+
    '<RunOnlyIfNetworkAvailable>false</RunOnlyIfNetworkAvailable><AllowStartOnDemand>true</AllowStartOnDemand>'+
    '<Enabled>true</Enabled><Hidden>false</Hidden><WakeToRun>false</WakeToRun><ExecutionTimeLimit>PT24H</ExecutionTimeLimit></Settings>\n'+
    '<Actions Context="Operator"><Exec><Command>'+xml(node)+'</Command><Arguments>'+xml(args)+'</Arguments><WorkingDirectory>'+
    xml(checkout)+'</WorkingDirectory></Exec></Actions>\n</Task>\n';
}
