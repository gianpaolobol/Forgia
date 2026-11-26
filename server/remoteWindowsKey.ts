import {spawnSync} from 'node:child_process';
import {lstatSync,realpathSync} from 'node:fs';
import {join,resolve,sep} from 'node:path';
import {fileURLToPath,URL} from 'node:url';

function localDirectory(directory:string) {
  if (process.platform!=='win32') throw Error('Windows key source unavailable');
  if (!/^[a-z]:\\(?:[^\\]+\\)*[^\\]+\\?$/i.test(directory))
    throw Error('Local drive directory required');
  const path=resolve(directory);
  const info=lstatSync(path);
  if (!info.isDirectory() || info.isSymbolicLink() ||
      realpathSync.native(path).toLowerCase()!==path.toLowerCase())
    throw Error('Invalid key directory');
  return path;
}

// ACLs and ownership of all directories and their parents are a prerequisite.
// Do not use network/synced storage, untrusted checkout, or elevated processes.
export function assertSeparateWindowsVault(vault:string,keyDirectory:string) {
  const a=localDirectory(vault).toLowerCase();
  const b=localDirectory(keyDirectory).toLowerCase();
  if (a===b || a.startsWith(b+sep) || b.startsWith(a+sep))
    throw Error('Vault and key directories must be separate');
}
function call(action:'init'|'read',directory:string) {
  const dir=localDirectory(directory);
  const path=join(dir,'remote-key-v1.dpapi');
  if (action==='read') {
    const info=lstatSync(path);
    if (!info.isFile() || info.isSymbolicLink() || info.nlink!==1 ||
        info.size<1 || info.size>4096) throw Error('Invalid protected key file');
  }
  const root=process.env.SystemRoot;
  if (!root || !/^[a-z]:\\/i.test(root)) throw Error('Windows key source unavailable');
  const exe=join(root,'System32','WindowsPowerShell','v1.0','powershell.exe');
  const script=fileURLToPath(new URL('../scripts/remote-key-dpapi.ps1',import.meta.url));
  // No shell, profile, policy bypass, secret arguments or environment values.
  const child=spawnSync(exe,['-NoLogo','-NoProfile','-NonInteractive','-File',script,action,dir],{
    stdio:['ignore','pipe','pipe'],windowsHide:true,timeout:8000,maxBuffer:4096,
  });
  try {
    if (child.error || child.status!==0 || child.signal ||
        !child.stdout || !child.stderr || child.stderr.length!==0)
      throw Error('Windows key source refused');
    if (action==='init') {
      if (child.stdout.length!==0) throw Error('Unexpected key source output');
      return '';
    }
    const key=child.stdout.toString('ascii');
    if (child.stdout.length!==64 || !/^[a-f0-9]{64}$/.test(key))
      throw Error('Invalid key source output');
    return key;
  } finally { child.stdout?.fill(0); child.stderr?.fill(0); }
}
export function initializeWindowsVaultKey(directory:string):void { call('init',directory); }
export function readWindowsVaultKey(directory:string):string { return call('read',directory); }
