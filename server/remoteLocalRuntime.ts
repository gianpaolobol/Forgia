import {closeSync, lstatSync, openSync, realpathSync} from 'node:fs';
import {isAbsolute, join, resolve} from 'node:path';
import {DatabaseSync} from 'node:sqlite';
import {RemoteNodeStatus} from './remoteNodeStatus.ts';
import {listenRemoteStatus} from './remoteStatusHttp.ts';

// Only an already private, local directory owned/controlled by the operator.
// Windows ACLs must be provisioned and verified out of band; POSIX checks are
// an additional guard, not a substitute for a trustworthy local OS.
export function openRemoteLocalDb(directory: string, role: 'control' | 'agent' | 'vault') {
  if (!isAbsolute(directory) || (role !== 'control' && role !== 'agent' && role !== 'vault'))
    throw Error('Invalid local state configuration');
  const dir = resolve(directory);
  const info = lstatSync(dir);
  if (!info.isDirectory() || info.isSymbolicLink() ||
      realpathSync(dir) !== dir) throw Error('Invalid local state directory');
  const uid = process.getuid?.();
  if (uid !== undefined && (info.uid !== uid || (info.mode & 0o077) !== 0))
    throw Error('Local state directory must be private');
  const path = join(dir, role === 'control' ? 'control.sqlite' : role === 'agent' ? 'agent.sqlite' : 'credentials.sqlite');
  try { closeSync(openSync(path,'wx',0o600)); }
  catch (error) { if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error; }
  const file = lstatSync(path);
  if (!file.isFile() || file.isSymbolicLink() || file.nlink !== 1 ||
      (uid !== undefined && (file.uid !== uid || (file.mode & 0o077) !== 0)))
    throw Error('Invalid local state file');
  // Never open a stale or redirected SQLite sidecar. This runtime uses DELETE
  // journal mode; a genuine hot journal may be recovered by SQLite.
  for (const suffix of ['-journal','-wal','-shm']) {
    try {
      const side = lstatSync(path+suffix);
      if (!side.isFile() || side.isSymbolicLink() || side.nlink !== 1 ||
          (uid !== undefined && (side.uid !== uid || (side.mode & 0o077) !== 0)))
        throw Error('Invalid local state sidecar');
    } catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; }
  }
  const db = new DatabaseSync(path);
  try {
    db.exec('PRAGMA busy_timeout=3000; PRAGMA foreign_keys=ON; PRAGMA synchronous=FULL;');
    if (db.prepare('PRAGMA journal_mode=DELETE').get()?.journal_mode !== 'delete')
      throw Error('Invalid local journal mode');
    return db;
  } catch (error) { db.close(); throw error; }
}

export async function startRemoteLocalHost(directory: string, port: number) {
  const db = openRemoteLocalDb(directory,'control');
  try {
    const server = await listenRemoteStatus(new RemoteNodeStatus(db),port);
    let closing: Promise<void> | undefined;
    return {
      server,
      close() {
        if (!closing) closing = new Promise<void>((resolve,reject) => {
          server.close(error => {
            try { db.close(); }
            catch (dbError) { reject(dbError); return; }
            if (error) reject(error); else resolve();
          });
        });
        return closing;
      },
    };
  } catch (error) { db.close(); throw error; }
}
