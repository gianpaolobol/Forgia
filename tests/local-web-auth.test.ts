import test from 'node:test';
import assert from 'node:assert/strict';
import {localWebAuth,localWebOrigin,verifyLocalWebMode,verifyLocalWebRecovery} from '../src/core/localWebAuth.ts';
import {decodeJobRecovery,closeJob} from '../src/core/jobRecovery.ts';
const session='00112233-4455-6677-8899-aabbccddeeff', code='a'.repeat(64);
test('UW1 local web credentials cannot be sent to another origin or partially configured',()=>{
 assert.equal(localWebAuth(localWebOrigin,'',''),undefined);
 assert.throws(()=>localWebAuth('https://example.com',session,code));
 assert.throws(()=>localWebAuth(localWebOrigin,session,''));
 const auth=localWebAuth(localWebOrigin,session,code)!;
 assert.deepEqual(auth.headers,{Authorization:'Bearer '+code,'X-Forgia-Require-Auth':'1'});
 assert.throws(()=>verifyLocalWebMode({},auth));
 assert.throws(()=>verifyLocalWebMode({durableAuthorizationRequired:true,durableSession:'other'},auth));
 assert.throws(()=>verifyLocalWebMode({durableAuthorizationRequired:true},undefined));
 verifyLocalWebMode({durableAuthorizationRequired:true,durableSession:session},auth);
 verifyLocalWebMode({},undefined);
});
test('UW2 protected receipt keeps mode and session, never bearer, rejects downgrade or other account',()=>{
 const marker=decodeJobRecovery({origin:localWebOrigin,session,state:'submitting',protectedLocal:true,bearer:code});
 assert.deepEqual(marker,{origin:localWebOrigin,session,state:'submitting',protectedLocal:true});
 assert.equal(closeJob(marker).protectedLocal,true);
 assert.throws(()=>verifyLocalWebRecovery(marker,undefined));
 assert.throws(()=>verifyLocalWebRecovery(marker,localWebAuth(localWebOrigin,'00112233-4455-6677-8899-aabbccddee00',code)));
 assert.throws(()=>verifyLocalWebRecovery(decodeJobRecovery({origin:localWebOrigin,session,state:'submitting'}),localWebAuth(localWebOrigin,session,code)));
 verifyLocalWebRecovery(marker,localWebAuth(localWebOrigin,session,code));
 assert.throws(()=>decodeJobRecovery({origin:'https://192.168.1.2',state:'submitting',protectedLocal:true}));
});
