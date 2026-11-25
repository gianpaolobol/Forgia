export default ({config}) => {
  const ca = process.env.FORGIA_LAN_PILOT_CA;
  const iosPilot = process.env.EXPO_PUBLIC_FORGIA_IOS_LAN_PILOT === '1';
  const androidPilot = process.env.EXPO_PUBLIC_FORGIA_ANDROID_LAN_PILOT === '1';
  if (!androidPilot && !iosPilot) return config;

  const ios = iosPilot ? {...config.ios, buildNumber: '3', infoPlist: {
    ...config.ios?.infoPlist,
    NSAppTransportSecurity: {...config.ios?.infoPlist?.NSAppTransportSecurity, NSAllowsLocalNetworking: true},
    NSLocalNetworkUsageDescription: 'Forgia si collega al PC sulla rete locale durante il collaudo.',
  }} : config.ios;
  if (!androidPilot) return {...config, ios};
  if (!ca) throw Error('Il pilota Android richiede il certificato CA.');

  const value = (process.env.EXPO_PUBLIC_FORGIA_PILOT_URL ?? '').trim();
  const match = /^https:\/\/(\d{1,3}(?:\.\d{1,3}){3})(?::([1-9]\d{0,4}))?\/?$/.exec(value);
  const address = match?.[1] ?? '';
  const parts = address.split('.');
  const octets = parts.map(Number);
  const [first, second] = octets;
  const privateIPv4 = octets.length === 4 && octets.every((n, i) => n <= 255 && String(n) === parts[i]) &&
    (first === 10 || (first === 172 && second >= 16 && second <= 31) || (first === 192 && second === 168));
  if (!match || !privateIPv4 || (match[2] && Number(match[2]) > 65535)) {
    throw Error('Il certificato pilota richiede un’origine HTTPS IPv4 privata.');
  }
  return {
    ...config,
    android: {...config.android, package: 'it.gianpaolofranceschini.forgia.lanpilot'},
    ios,
    plugins: [...(config.plugins ?? []), ['./scripts/with-lan-pilot.cjs', {host: address, ca}]],
  };
};
