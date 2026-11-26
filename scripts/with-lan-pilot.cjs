const {withAndroidManifest, withDangerousMod} = require('expo/config-plugins');
const {X509Certificate} = require('node:crypto');
const {readFile, mkdir, writeFile} = require('node:fs/promises');
const {join} = require('node:path');

module.exports = (config, {host, ca}) => {
  if (!/^\d{1,3}(\.\d{1,3}){3}$/.test(host)) throw Error('Indirizzo IPv4 pilota non valido.');
  config = withAndroidManifest(config, mod => {
    const application = mod.modResults.manifest.application?.[0];
    if (!application) throw Error('Applicazione Android mancante.');
    if (application.$['android:networkSecurityConfig'] &&
        application.$['android:networkSecurityConfig'] !== '@xml/forgia_lan_pilot') {
      throw Error('Configurazione TLS Android gia presente.');
    }
    application.$['android:networkSecurityConfig'] = '@xml/forgia_lan_pilot';
    return mod;
  });
  return withDangerousMod(config, ['android', async mod => {
    const certificate = new X509Certificate(await readFile(ca));
    if (!certificate.ca) throw Error('Il file pilota deve contenere un certificato CA pubblico.');
    const res = join(mod.modRequest.platformProjectRoot, 'app', 'src', 'main', 'res');
    await Promise.all(['raw', 'xml'].map(dir => mkdir(join(res, dir), {recursive: true})));
    await Promise.all([
      writeFile(join(res, 'raw', 'forgia_lan_ca.cer'), certificate.raw),
      writeFile(join(res, 'xml', 'forgia_lan_pilot.xml'), `<?xml version="1.0" encoding="utf-8"?>
<network-security-config>
  <domain-config cleartextTrafficPermitted="false">
    <domain includeSubdomains="false">${host}</domain>
    <trust-anchors><certificates src="@raw/forgia_lan_ca" /></trust-anchors>
  </domain-config>
</network-security-config>
`),
    ]);
    return mod;
  }]);
};
