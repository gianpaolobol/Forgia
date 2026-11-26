import {createCipheriv,createDecipheriv,randomBytes} from 'node:crypto';
import type {DatabaseSync} from 'node:sqlite';

export type VaultRole = 'node' | 'operator';
const hex64 = /^[a-f0-9]{64}$/;
function validate(role: VaultRole,key: string) {
  if ((role !== 'node' && role !== 'operator') || !hex64.test(key))
    throw Error('Invalid vault input');
}
const aad = (role: VaultRole) => Buffer.from('forgia-remote-credential:v1:'+role,'utf8');

// Local encrypted envelope store. The random key must be supplied by an
// independently protected local key source, never stored in this database.
// SQLite insert is atomic; an existing role is never silently overwritten.
export class RemoteCredentialVault {
  private readonly db: DatabaseSync;
  constructor(db: DatabaseSync) {
    this.db=db;
    db.exec(`CREATE TABLE IF NOT EXISTS remote_credential_v1 (
      role TEXT PRIMARY KEY CHECK(role IN ('node','operator')),
      iv BLOB NOT NULL CHECK(length(iv)=12),
      ciphertext BLOB NOT NULL CHECK(length(ciphertext)=64),
      tag BLOB NOT NULL CHECK(length(tag)=16)
    ) STRICT`);
  }
  import(role: VaultRole,key: string,token: string) {
    validate(role,key);
    if (!hex64.test(token)) throw Error('Invalid vault credential');
    const bytes=Buffer.from(key,'hex');
    const plain=Buffer.from(token,'ascii');
    try {
      const iv=randomBytes(12);
      const cipher=createCipheriv('aes-256-gcm',bytes,iv);
      cipher.setAAD(aad(role));
      const ciphertext=Buffer.concat([cipher.update(plain),cipher.final()]);
      this.db.prepare('INSERT INTO remote_credential_v1(role,iv,ciphertext,tag) VALUES (?,?,?,?)')
        .run(role,iv,ciphertext,cipher.getAuthTag());
    } finally { bytes.fill(0); plain.fill(0); }
  }
  read(role: VaultRole,key: string): string {
    validate(role,key);
    const row=this.db.prepare('SELECT iv,ciphertext,tag FROM remote_credential_v1 WHERE role=?').get(role);
    if (!row || !(row.iv instanceof Uint8Array) || row.iv.length!==12 ||
        !(row.ciphertext instanceof Uint8Array) || row.ciphertext.length!==64 ||
        !(row.tag instanceof Uint8Array) || row.tag.length!==16)
      throw Error('Vault credential unavailable');
    const bytes=Buffer.from(key,'hex');
    let part: Buffer | undefined;
    let final: Buffer | undefined;
    let plain: Buffer | undefined;
    try {
      const decipher=createDecipheriv('aes-256-gcm',bytes,row.iv);
      decipher.setAAD(aad(role));
      decipher.setAuthTag(row.tag);
      part=decipher.update(row.ciphertext);
      final=decipher.final();
      plain=Buffer.concat([part,final]);
      const token=plain.toString('ascii');
      if (!hex64.test(token)) throw Error('Invalid vault credential');
      return token;
    } finally { bytes.fill(0); part?.fill(0); final?.fill(0); plain?.fill(0); }
  }
}
