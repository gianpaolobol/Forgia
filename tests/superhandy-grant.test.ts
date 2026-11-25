import test,{type TestContext} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync,writeFileSync,chmodSync,symlinkSync,unlinkSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {localSpecAuthorization} from '../server/superhandyGrant.ts';
const scope={baselineSha:'a'.repeat(64),actor:'executor',taskId:'task-a',provider:'local',model:'qwen:1b'};
function fixture(t:TestContext){
 const dir=mkdtempSync(join(tmpdir(),'forgia-grant-')),path=join(dir,'grant.json');let now=1000;
 const grant={version:1,...scope,expiresAt:2000};
 const write=(value:unknown=grant)=>writeFileSync(path,JSON.stringify(value),{mode:0o600});write();
 t.after(()=>rmSync(dir,{recursive:true,force:true}));
 return {dir,path,grant,write,advance:()=>{now=2000;},auth:()=>localSpecAuthorization(path,()=>now)};
}
test('G1 exact scope and digest stable, no extra privileges',t=>{
 const f=fixture(t),check=f.auth(),digest=check(scope);assert.match(digest,/^[a-f0-9]{64}$/);assert.equal(check(scope,digest),digest);
 for(const key of Object.keys(scope) as (keyof typeof scope)[])assert.throws(()=>check({...scope,[key]:'other'}));
 f.write({...f.grant,cloudConsent:true});assert.throws(()=>f.auth()(scope));
});
test('G1 expiry and invalid provider/model fail closed',t=>{
 const f=fixture(t);f.advance();assert.throws(()=>f.auth()(scope));
 for(const [provider,model] of [['groq','x'],['local','x-cloud'],['llamacpp','https://x']]){f.write({...f.grant,provider,model,expiresAt:3000});assert.throws(()=>f.auth()({...scope,provider,model}));}
 f.write({...f.grant,expiresAt:2000+86400001});assert.throws(()=>f.auth()(scope));
});
test('G2 refuses public file, directory and symlink',t=>{
 if(process.platform==='win32'){t.skip('POSIX mode and symlink');return;}
 const f=fixture(t);chmodSync(f.path,0o644);assert.throws(()=>f.auth()(scope));chmodSync(f.path,0o600);
 chmodSync(f.dir,0o755);assert.throws(()=>f.auth()(scope));chmodSync(f.dir,0o700);
 const target=join(f.dir,'other.json');writeFileSync(target,JSON.stringify(f.grant),{mode:0o600});unlinkSync(f.path);symlinkSync(target,f.path);assert.throws(()=>f.auth()(scope));
});
test('G3 replacement or revocation rejects subsequent checks',t=>{
 const f=fixture(t),check=f.auth(),digest=check(scope);f.write({...f.grant,expiresAt:3000});assert.throws(()=>check(scope));assert.throws(()=>f.auth()(scope,digest));unlinkSync(f.path);assert.throws(()=>check(scope));
});
test('G4 restart with original grant works; wrong digest does not',t=>{
 const f=fixture(t),digest=f.auth()(scope);assert.equal(f.auth()(scope,digest),digest);assert.throws(()=>f.auth()(scope,'b'.repeat(64)));
});
