import {setTimeout as delay} from 'node:timers/promises';
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

async function readCredential() {
  // No command-line or environment secrets. An approved local vault process
  // supplies exactly one token followed by EOF on a private pipe.
  if (process.stdin.isTTY) throw Error('Credential pipe required');
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of process.stdin) {
    const bytes = Buffer.from(chunk);
    size += bytes.length;
    if (size > 66) throw Error('Invalid credential');
    chunks.push(bytes);
  }
  const token = Buffer.concat(chunks).toString('ascii').replace(/\r?\n$/,'');
  if (!/^[a-f0-9]{64}$/.test(token)) throw Error('Invalid credential');
  return token;
}

async function main(args: string[]) {
  const [cmd,dir,a,b,c] = args;
  if (!dir) throw Error('Missing state directory');
  if (cmd === 'serve' && args.length === 3) {
    const host = await startRemoteLocalHost(dir,integer(a,1,65535));
    try {
      console.log('Remote status listening on loopback only.');
      if (!stop.signal.aborted) await new Promise<void>(resolve =>
        stop.signal.addEventListener('abort',() => resolve(),{once:true}));
    } finally { await host.close(); }
    return;
  }
  if (cmd === 'agent' && args.length === 3) {
    const port = integer(a,1,65535);
    const token = await readCredential();
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
  if (!((cmd === 'register' && args.length === 3) ||
        (cmd === 'revoke' && args.length === 3) ||
        (cmd === 'issue' && args.length === 5))) throw Error('Invalid command');
  const db = openRemoteLocalDb(dir,'control');
  try {
    const store = new RemoteNodeStatus(db);
    if (cmd === 'register') { store.register(a); console.log('Node registered.'); }
    else if (cmd === 'revoke') console.log(store.revoke(a) ? 'Revoked.' : 'No active grant.');
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
