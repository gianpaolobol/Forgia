import {provisionRemoteCredential} from '../server/remoteLocalProvision.ts';
import {runRemoteLocalSupervisor} from '../server/remoteLocalSupervisor.ts';
import {readRemoteNodeStatus} from '../src/core/remoteStatusClient.ts';
import {setTimeout as delay} from 'node:timers/promises';
import {initializeWindowsVaultKey,readWindowsVaultKey,assertSeparateWindowsVault} from '../server/remoteWindowsKey.ts';
import {RemoteCredentialVault,type VaultRole} from '../server/remoteCredentialVault.ts';
import {RemoteNodeStatus} from '../server/remoteNodeStatus.ts';
import {RemoteHeartbeatAgent} from '../server/remoteHeartbeatAgent.ts';
import {openRemoteLocalDb,startRemoteLocalHost} from '../server/remoteLocalRuntime.ts';

const stop = new AbortController();
process.once('SIGINT',() => stop.abort());
process.once('SIGTERM',() => stop.abort());

function integer(value: string | undefined, min: number, max: number) {
  if (!value || !/^[0-9]+$/.test(value)) throw Error('Invalid number');
  const n = Number(value);
  if (!Number.isSafeInteger(n) || n < min || n > max) throw Error('Invalid number');
  return n;
}

async function readSecretLines(count: 1 | 2) {
  // No command-line or environment secrets. An approved local vault process
  // supplies exactly one token followed by EOF on a private pipe.
  if (process.stdin.isTTY) throw Error('Credential pipe required');
  const chunks: Buffer[] = [];
  let size = 0;
  const abort = () => process.stdin.destroy(Error('Credential input interrupted'));
  const timer = setTimeout(abort,10_000);
  stop.signal.addEventListener('abort',abort,{once:true});
  try {
    if (stop.signal.aborted) throw Error('Credential input interrupted');
    for await (const chunk of process.stdin) {
      const bytes = Buffer.from(chunk);
      size += bytes.length;
      if (size > 66*count) throw Error('Invalid credential');
      chunks.push(bytes);
    }
  } finally {
    clearTimeout(timer);
    stop.signal.removeEventListener('abort',abort);
  }
  const combined=Buffer.concat(chunks);
  try {
    const lines=combined.toString('utf8').replace(/\r?\n$/,'').split(/\r?\n/);
    if (lines.length!==count || lines.some(line=>!/^[a-f0-9]{64}$/.test(line)))
      throw Error('Invalid credential');
    return lines;
  } finally { combined.fill(0); for (const chunk of chunks) chunk.fill(0); }
}
async function readCredential() { return (await readSecretLines(1))[0]; }
async function readVaultCredential(directory: string,role: VaultRole,keyDirectory?:string) {
  const key=keyDirectory ? (assertSeparateWindowsVault(directory,keyDirectory),readWindowsVaultKey(keyDirectory)) : await readCredential();
  const db=openRemoteLocalDb(directory,'vault',true);
  try { return new RemoteCredentialVault(db,true).read(role,key); }
  finally { db.close(); }
}

async function main(args: string[]) {
  const [cmd,dir,a,b,c] = args;
  if (cmd==='vault-key-init' && args.length===2 && dir) {
    initializeWindowsVaultKey(dir);
    console.log('Windows protected key initialized.');
    return;
  }
  if (cmd==='vault-import-os' && args.length===4 && dir && b && (a==='node' || a==='operator')) {
    assertSeparateWindowsVault(dir,b);
    const token=await readCredential();
    const key=readWindowsVaultKey(b);
    const db=openRemoteLocalDb(dir,'vault');
    try { new RemoteCredentialVault(db).import(a,key,token); }
    finally { db.close(); }
    console.log('Encrypted credential imported.');
    return;
  }
  // Import an already issued credential via private stdin only; never issue
  // a grant or print the token. The vault directory is independently private.
  if (cmd === 'vault-import' && args.length === 3 && dir && (a==='node' || a==='operator')) {
    const [key,token]=await readSecretLines(2);
    const db=openRemoteLocalDb(dir,'vault');
    try { new RemoteCredentialVault(db).import(a,key,token); }
    finally { db.close(); }
    console.log('Encrypted credential imported.');
    return;
  }
  if (dir && ((cmd === 'status-vault' && args.length === 3) || (cmd==='status-os' && args.length===4 && b))) {
    const port=integer(a,1,65535);
    if (port===8787) throw Error('Gateway port forbidden');
    const status=await readRemoteNodeStatus(port,await readVaultCredential(dir,'operator',cmd==='status-os' ? b : undefined));
    if (stop.signal.aborted) throw Error('Status interrupted');
    console.log(JSON.stringify(status));
    return;
  }
  // Read-only operator command, no control database or administrative access required.
  if (cmd === 'status' && args.length === 2) {
    const port = integer(dir,1,65535);
    if (port === 8787) throw Error('Gateway port forbidden');
    const token = await readCredential();
    const status = await readRemoteNodeStatus(port,token);
    if (stop.signal.aborted) throw Error('Status interrupted');
    console.log(JSON.stringify(status));
    return;
  }
  if (!dir) throw Error('Missing state directory');
  // The diagnostic queue is local only. Operator authority is still checked
  // transactionally. Credential supplied over the same bounded private pipe.
  if ((cmd==='snapshot-request'||cmd==='snapshot-read') && args.length===3 && a) {
    const token=await readCredential();
    const db=openRemoteLocalDb(dir,'control');
    try {
      const store=new RemoteNodeStatus(db);
      const value=cmd==='snapshot-request'?store.requestSnapshot(token,a):store.readSnapshot(token,a);
      console.log(JSON.stringify(value));
    } finally { db.close(); }
    return;
  }
  if (cmd==='run-os' && args.length===5 && b && c) {
    const port=integer(a,1,65535);
    if (port===8787) throw Error('Gateway port forbidden');
    assertSeparateWindowsVault(dir,b);
    assertSeparateWindowsVault(dir,c);
    const token=await readVaultCredential(b,'node',c);
    const outcome=await runRemoteLocalSupervisor(dir,port,token,stop.signal,
      () => console.log('Local host and authorized heartbeat ready.'));
    if (outcome==='denied') { console.error('Node authorization denied.'); process.exitCode=2; }
    else if (outcome==='unavailable') { console.error('Local heartbeat unavailable.'); process.exitCode=1; }
    return;
  }
  if (cmd === 'serve' && args.length === 3) {
    const host = await startRemoteLocalHost(dir,integer(a,1,65535));
    try {
      console.log('Remote status listening on loopback only.');
      if (!stop.signal.aborted) await new Promise<void>(resolve =>
        stop.signal.addEventListener('abort',() => resolve(),{once:true}));
    } finally { await host.close(); }
    return;
  }
  if ((cmd === 'agent' && args.length === 3) || (cmd === 'agent-vault' && args.length === 4 && b) || (cmd==='agent-os' && args.length===5 && b && c)) {
    const port = integer(a,1,65535);
    if (port===8787) throw Error('Gateway port forbidden');
    const token = cmd==='agent-vault' || cmd==='agent-os' ? await readVaultCredential(b!,'node',cmd==='agent-os' ? c : undefined) : await readCredential();
    const db = openRemoteLocalDb(dir,'agent');
    try {
      const agent = new RemoteHeartbeatAgent(db,port,token);
      try {
        while (!stop.signal.aborted) {
          const result = await agent.pulse();
          if (result === 'denied') { console.error('Node authorization denied.'); process.exitCode=2; break; }
          try { await delay(30_000,undefined,{signal:stop.signal}); }
          catch (error) { if (!stop.signal.aborted) throw error; }
        }
      } finally { await agent.stop(); }
    } finally { db.close(); }
    return;
  }
  // Admin commands are explicitly local and never exposed through HTTP.
  if (!process.stdin.isTTY || !process.stdout.isTTY) throw Error('Local interactive administrator terminal required');
  if(cmd==='provision-os' && args.length===7 && a && (b==='node'||b==='operator') && c && args[5] && args[6]){
    const vault=args[5],keyDirectory=args[6];
    assertSeparateWindowsVault(dir,vault);
    assertSeparateWindowsVault(dir,keyDirectory);
    assertSeparateWindowsVault(vault,keyDirectory);
    const key=readWindowsVaultKey(keyDirectory);
    const grant=provisionRemoteCredential(dir,vault,a,b,integer(c,1,1440)*60_000,key);
    console.log(JSON.stringify(grant));
    return;
  }
  if (!((cmd === 'register' && args.length === 3) ||
        (cmd === 'inspect-grants' && args.length === 3) ||
        (cmd === 'revoke' && args.length === 3) ||
        (cmd === 'issue' && args.length === 5))) throw Error('Invalid command');
  if (!a) throw Error('Missing administrator argument');
  const db = openRemoteLocalDb(dir,'control');
  try {
    const store = new RemoteNodeStatus(db);
    if (cmd === 'register') { store.register(a); console.log('Node registered.'); }
    else if (cmd === 'revoke') console.log(store.revoke(a) ? 'Revoked.' : 'No active grant.');
    else if (cmd === 'inspect-grants') console.log(JSON.stringify(store.inspectGrants(a)));
    else {
      if (b !== 'node' && b !== 'operator') throw Error('Invalid role');
      const grant = store.issue(a,b,integer(c,1,1440)*60_000);
      // Explicit one-time handover on a local TTY, never redirect to a log.
      console.log('Grant ID: '+grant.id+'; expires: '+new Date(grant.expiresAt).toISOString());
      console.log('One-time credential (transfer privately to your approved vault): '+grant.token);
    }
  } finally { db.close(); }
}

main(process.argv.slice(2)).catch(() => {
  // Do not echo input, path, token, stack, or database details.
  console.error('Remote local runtime refused or failed. See the local runbook.');
  process.exitCode=1;
});
