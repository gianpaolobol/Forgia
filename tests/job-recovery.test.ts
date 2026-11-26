import test from 'node:test';
import assert from 'node:assert/strict';
import {closeJob,decodeJobRecovery,recoveryAction} from '../src/core/jobRecovery.ts';
const origin='http://127.0.0.1:8787';
const session='00112233-4455-6677-8899-aabbccddeeff';
const id='abcdef01-2345-6789-abcd-ef0123456789';
test('marker prima di POST: un esito ambiguo non autorizza replay',()=>{
 const job=decodeJobRecovery({origin,session,state:'submitting'});
 assert.equal(recoveryAction(undefined,origin),'submit');
 assert.equal(recoveryAction(job,origin),'blocked');
 assert.equal(recoveryAction(closeJob(job),origin),'blocked');
});
test('ricevuta persistita autorizza soltanto polling del gateway originale',()=>{
 const job=decodeJobRecovery(JSON.parse(JSON.stringify({origin,session,state:'accepted',id})));
 assert.equal(recoveryAction(job,origin),'poll');
 assert.equal(recoveryAction(job,'https://192.168.1.2'),'blocked');
 assert.equal(recoveryAction(closeJob(job),origin),'blocked');
});
test('rifiuta URL, sessioni e identificativi invalidi e non conserva bearer',()=>{
 assert.throws(()=>decodeJobRecovery({origin:'https://example.com',state:'accepted',id}));
 assert.throws(()=>decodeJobRecovery({origin,state:'accepted',id}));
 assert.throws(()=>decodeJobRecovery({origin,session,state:'accepted',id:'../providers'}));
 assert.throws(()=>decodeJobRecovery({origin,session,state:'submitting',id}));
 const pilot=decodeJobRecovery({origin:'https://192.168.1.2',state:'accepted',id,bearer:'synthetic'});
 assert.deepEqual(pilot,{origin:'https://192.168.1.2',state:'accepted',id});
});
