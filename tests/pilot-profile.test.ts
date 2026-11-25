import test from 'node:test';
import assert from 'node:assert/strict';
import {pilotConnection} from '../src/core/lanPilot.ts';

const configPath = '../app.config.js';
const {default: appConfig} = await import(configPath);
const keys = ['EXPO_PUBLIC_FORGIA_IOS_LAN_PILOT', 'EXPO_PUBLIC_FORGIA_ANDROID_LAN_PILOT',
  'EXPO_PUBLIC_FORGIA_PILOT_URL', 'FORGIA_LAN_PILOT_CA'] as const;
const base = {ios: {buildNumber: '2', infoPlist: {existing: true}}, android: {package: 'standard'}, plugins: ['existing']};
const local = 'https://192.168.1.11:8443';
function configure(ios?: string, android?: string, url?: string, ca?: string) {
  const old = keys.map(key => process.env[key]);
  try {
    [ios, android, url, ca].forEach((value, i) => {
      if (value === undefined) delete process.env[keys[i]];
      else process.env[keys[i]] = value;
    });
    return appConfig({config: base});
  } finally {
    old.forEach((value, i) => {
      if (value === undefined) delete process.env[keys[i]];
      else process.env[keys[i]] = value;
    });
  }
}
for (const platform of ['ios', 'android']) {
  for (const url of [undefined, local, 'https://8.8.8.8']) {
    test(`standard ${platform} ignores URL ${url}`, () => {
      const result = pilotConnection(platform, undefined, '0', url, local);
      assert.equal(result.nativePilot, false);
      assert.equal(result.api, undefined);
      assert.equal(result.initialAddress, undefined);
      assert.deepEqual(configure('0', undefined, url, 'unused-ca'), base);
    });
  }
}
test('platform-specific flags do not cross-enable', () => {
  assert.equal(pilotConnection('android', '1', undefined, local).api, undefined);
  assert.equal(pilotConnection('ios', undefined, '1', local).api, undefined);
});
test('web always stays loopback', () => {
  assert.deepEqual(pilotConnection('web', '1', '1', local), {
    iosLanPilot: false, nativePilot: false, initialAddress: undefined, api: 'http://127.0.0.1:8787',
  });
});
test('iOS explicit pilot accepts edited private origin but never public or cleared input', () => {
  assert.equal(pilotConnection('ios', '1', '0', undefined, local).api, local);
  assert.equal(pilotConnection('ios', '1', '0', local, '').api, undefined);
  assert.equal(pilotConnection('ios', '1', '0', local, 'https://8.8.8.8').api, undefined);
  const config = configure('1');
  assert.equal(config.ios.buildNumber, '3');
  assert.equal(config.ios.infoPlist.NSAppTransportSecurity.NSAllowsLocalNetworking, true);
  assert.equal(config.ios.infoPlist.existing, true);
  assert.deepEqual(config.android, base.android);
  assert.deepEqual(config.plugins, base.plugins);
});
test('Android requires CA and does not modify iOS', () => {
  assert.throws(() => configure('0', '1', local), /CA/);
  const config = configure('0', '1', local, 'public-ca.cer');
  assert.equal(config.android.package, 'it.gianpaolofranceschini.forgia.lanpilot');
  assert.deepEqual(config.ios, base.ios);
  assert.deepEqual(config.plugins.at(-1), ['./scripts/with-lan-pilot.cjs', {host: '192.168.1.11', ca: 'public-ca.cer'}]);
  assert.equal(pilotConnection('android', '0', '1', local, 'https://10.0.0.1').api, local);
});
for (const url of [undefined, 'https://8.8.8.8', 'https://localhost', 'http://192.168.1.1',
  'https://192.168.01.1', 'https://192.168.1.256', 'https://192.168.1.1:65536',
  'https://192.168.1.1:0', 'https://192.168.1.1/path', 'https://192.168.1.1@8.8.8.8',
  'https://192.168.1.1/?x=1']) {
  test(`Android config and runtime reject ${url}`, () => {
    assert.throws(() => configure('0', '1', url, 'public-ca.cer'), /HTTPS IPv4 privata/);
    assert.equal(pilotConnection('android', '0', '1', url).api, undefined);
  });
}
for (const [url, expected] of [[local, local], [' https://10.0.0.1/ ', 'https://10.0.0.1'],
  ['https://172.31.0.1:65535', 'https://172.31.0.1:65535']]) {
  test(`Android config and runtime accept ${url}`, () => {
    assert.doesNotThrow(() => configure('0', '1', url, 'public-ca.cer'));
    assert.equal(pilotConnection('android', '0', '1', url).api, expected);
  });
}
