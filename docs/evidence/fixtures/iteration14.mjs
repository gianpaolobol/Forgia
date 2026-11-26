import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {stripTypeScriptTypes} from 'node:module';
import {resolve} from 'node:path';
import {lanPilotOrigin} from './src/core/lanPilot.ts';
const original = await readFile(new URL('./server/main.ts', import.meta.url), 'utf8');
const code = stripTypeScriptTypes(original.replace(/^import .*;\n/gm, ''));
const AsyncFunction = Object.getPrototypeOf(async function() {}).constructor;
const run = new AsyncFunction('process','createServer','createHttpsServer','readFile','resolve','diskStorage','createGateway','createJobs','console',code);
async function startup(host, port = '8443') {
  const calls = [];
  const server = kind => () => ({listen(p,h) { calls.push({kind,port:p,host:h}); }});
  const env = {FORGIA_PILOT_PORT:port, FORGIA_PILOT_TLS_CERT:'synthetic-cert', FORGIA_PILOT_TLS_KEY:'synthetic-key', FORGIA_PILOT_ACCOUNTS:'synthetic-accounts'};
  if (host !== undefined) env.FORGIA_PILOT_HOST = host;
  let error;
  try {
    await run({env},server('http'),server('https'),async path => path === 'synthetic-accounts' ? '[]' : Buffer.from('synthetic'),resolve,()=>({}),()=>({}),()=>({}),{log(){}});
  } catch (e) { error = e; }
  return {calls,error};
}
test('default HTTP stays loopback; no pilot configured', async () => {
  const {calls,error} = await startup(undefined);
  assert.ifError(error);
  assert.deepEqual(calls,[{kind:'http',port:8787,host:'127.0.0.1'}]);
});
test('private IPv4 accepted by client and passed to pilot listener', async () => {
  const host = '192.168.1.20';
  assert.equal(lanPilotOrigin(`https://${host}:8443`),`https://${host}:8443`);
  const {calls,error} = await startup(host);
  assert.ifError(error);
  assert.deepEqual(calls,[{kind:'http',port:8787,host:'127.0.0.1'},{kind:'https',port:8443,host}]);
});
for (const host of ['0.0.0.0','::','203.0.113.10']) {
  test(`client and server must reject non-private pilot host ${host}`, async () => {
    assert.equal(lanPilotOrigin(`https://${host === '::' ? '[::]' : host}:8443`),undefined);
    const {calls,error} = await startup(host);
    assert.deepEqual(calls.filter(x=>x.kind==='https'),[],`unsafe host reaches listener: ${host}; error: ${error?.message ?? 'none'}`);
  });
}
test('invalid port rejected before pilot listen', async () => {
  const {calls,error} = await startup('192.168.1.20','65536');
  assert.ok(error);
  assert.equal(calls.filter(x=>x.kind==='https').length,0);
});
