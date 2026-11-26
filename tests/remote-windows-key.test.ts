import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,realpathSync,rmSync,readFileSync,writeFileSync,mkdirSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {spawnSync} from 'node:child_process';
import {fileURLToPath,URL} from 'node:url';
import {randomBytes} from 'node:crypto';
import {initializeWindowsVaultKey,readWindowsVaultKey,assertSeparateWindowsVault} from '../server/remoteWindowsKey.ts';
import {openRemoteLocalDb} from '../server/remoteLocalRuntime.ts';
import {RemoteCredentialVault} from '../server/remoteCredentialVault.ts';

const script=fileURLToPath(new URL('../scripts/remote-local.ts',import.meta.url));
const run=(args:string[],input='')=>spawnSync(process.execPath,
  ['--experimental-strip-types',script,...args],{input,encoding:'utf8',timeout:20_000});
test('RC25 DPAPI is explicit; non-Windows never falls back or writes a key',
  {skip:process.platform==='win32'},()=>{
    const dir=mkdtempSync(join(realpathSync(tmpdir()),'forgia-key-'));
    try {
      assert.throws(()=>initializeWindowsVaultKey(dir));
      assert.throws(()=>readWindowsVaultKey(dir));
      const result=run(['vault-key-init',dir]);
      assert.equal(result.status,1); assert.equal(result.stdout,'');
      assert.throws(()=>readFileSync(join(dir,'remote-key-v1.dpapi')));
    } finally { rmSync(dir,{recursive:true,force:true}); }
  });
test('RC26 Windows CurrentUser key persists, refuses overwrite and tampering',
  {skip:process.platform!=='win32',timeout:60_000},()=>{
    const dir=mkdtempSync(join(realpathSync(tmpdir()),'forgia-key-'));
    try {
      initializeWindowsVaultKey(dir);
      const key=readWindowsVaultKey(dir);
      assert.match(key,/^[a-f0-9]{64}$/);
      const path=join(dir,'remote-key-v1.dpapi'), blob=readFileSync(path);
      assert.ok(!blob.includes(Buffer.from(key,'hex')) && !blob.includes(Buffer.from(key)));
      assert.throws(()=>initializeWindowsVaultKey(dir));
      assert.equal(readWindowsVaultKey(dir),key);
      writeFileSync(path,Buffer.alloc(blob.length));
      assert.throws(()=>readWindowsVaultKey(dir));
    } finally { rmSync(dir,{recursive:true,force:true}); }
  });
test('RC27 Windows key source imports token into existing vault without echo',
  {skip:process.platform!=='win32',timeout:60_000},()=>{
    const root=mkdtempSync(join(realpathSync(tmpdir()),'forgia-key-'));
    const vd=join(root,'vault'), kd=join(root,'keys'), token=randomBytes(32).toString('hex');
    mkdirSync(vd); mkdirSync(kd);
    try {
      assert.throws(()=>assertSeparateWindowsVault(vd,vd));
      assert.equal(run(['vault-key-init',kd]).status,0);
      const result=run(['vault-import-os',vd,'operator',kd],token+'\n');
      assert.equal(result.status,0);
      assert.ok(!(result.stdout+result.stderr).includes(token));
      const db=openRemoteLocalDb(vd,'vault');
      try { assert.equal(new RemoteCredentialVault(db).read('operator',readWindowsVaultKey(kd)),token); }
      finally { db.close(); }
      assert.equal(run(['vault-import-os',vd,'operator',kd],token+'\n').status,1);
      assert.equal(run(['status-os',vd,'8787',kd]).status,1);
    } finally { rmSync(root,{recursive:true,force:true}); }
  });
