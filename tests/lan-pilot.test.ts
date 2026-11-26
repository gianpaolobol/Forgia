import test from 'node:test';
import assert from 'node:assert/strict';
import {lanPilotOrigin} from '../src/core/lanPilot.ts';

test('il pilota iPhone accetta soltanto origini HTTPS con IPv4 privato', () => {
  assert.equal(lanPilotOrigin(' https://192.168.1.11:8443/ '), 'https://192.168.1.11:8443');
  assert.equal(lanPilotOrigin('https://172.31.0.1'), 'https://172.31.0.1');
  for (const bad of ['http://192.168.1.1', 'https://1.1.1.1', 'https://192.168.01.1',
    'https://192.168.1.256', 'https://192.168.1.1:65536', 'https://192.168.1.1@1.1.1.1',
    'https://192.168.1.1/path', 'https://192.168.1.1/?test=1']) {
    assert.equal(lanPilotOrigin(bad), undefined, bad);
  }
});
