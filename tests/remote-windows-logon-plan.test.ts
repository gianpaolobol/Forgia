import {test} from 'node:test';
import assert from 'node:assert/strict';
import {windowsLogonTask} from '../server/remoteWindowsLogonPlan.ts';

const config={sid:'S-1-5-21-1-2-3-1001',nodeExe:'C:\\Program Files\\nodejs\\node.exe',
  checkout:'C:\\Forgia & Tools',state:'D:\\Private\\state',port:8791,
  vault:'D:\\Private\\vault',keyDir:'D:\\Private\\key'};
test('RC31 logon plan fixed least privilege interactive action and no retry',()=>{
  const plan=windowsLogonTask(config);
  assert.match(plan,/<LogonType>InteractiveToken<\/LogonType><RunLevel>LeastPrivilege<\/RunLevel>/);
  assert.match(plan,/<LogonTrigger><Enabled>true<\/Enabled><UserId>S-1-5-21-1-2-3-1001<\/UserId>/);
  assert.match(plan,/<MultipleInstancesPolicy>IgnoreNew<\/MultipleInstancesPolicy>/);
  assert.match(plan,/<StartWhenAvailable>false<\/StartWhenAvailable>/);
  assert.match(plan,/<ExecutionTimeLimit>PT24H<\/ExecutionTimeLimit>/);
  assert.match(plan,/<Command>C:\\Program Files\\nodejs\\node.exe<\/Command>/);
  assert.match(plan,/<Arguments>--experimental-strip-types &quot;C:\\Forgia &amp; Tools\\scripts\\remote-local\.ts&quot; run-os &quot;D:\\Private\\state&quot; 8791 &quot;D:\\Private\\vault&quot; &quot;D:\\Private\\key&quot;<\/Arguments>/);
  assert.doesNotMatch(plan,/RestartOnFailure|<Password>|HighestAvailable|BootTrigger|cmd\.exe|powershell\.exe/);
});
test('RC32 reject ambiguous paths and unsafe account/port',()=>{
  for(const override of [
    {sid:'S-1-5-18'},{sid:'S-1-5-32-544'},{port:8787},{port:0},{port:8791.2},
    {nodeExe:'C:\\Windows\\cmd.exe'},{checkout:'\\\\host\\share'},
    {state:'D:\\Private\\..\\state'},{state:'D:\\Private\\state '},
    {state:'D:\\Private\\%TEMP%'},{state:'D:\\Private\\state:stream'},
    {state:'D:\\Private\\state" evil'},{state:'D:\\Private\\NUL.txt'},
  ]) assert.throws(()=>windowsLogonTask({...config,...override}));
});
test('RC33 reject overlapping checkout and private directories case-insensitively',()=>{
  for(const override of [
    {vault:'d:\\private\\STATE'},{keyDir:'D:\\Private\\vault\\key'},
    {state:'c:\\forgia & tools\\state'},{checkout:'D:\\Private'},
  ]) assert.throws(()=>windowsLogonTask({...config,...override}));
  assert.equal(windowsLogonTask(config),windowsLogonTask(config));
});
