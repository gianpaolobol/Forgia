import test from 'node:test';
import assert from 'node:assert/strict';
import {pilotBindHost} from '../server/pilot.ts';

for (const host of ['10.0.0.2', '172.16.1.2', '172.31.255.1', '192.168.1.2']) {
  test(`pilot bind accepts ${host}`, () => assert.equal(pilotBindHost(host), host));
}
for (const host of ['0.0.0.0', '::', '::1', '127.0.0.1', '8.8.8.8', '172.15.1.2', '172.32.1.2', '100.64.0.1', 'localhost', '192.168.1.256', '192.168.001.2', '192.168.1.2:8443', '192.168.1.2/', '192.168.1.2 ', ' 192.168.1.2', '']) {
  test(`pilot bind rejects ${JSON.stringify(host)}`, () => assert.throws(() => pilotBindHost(host), /IPv4 privato/));
}
