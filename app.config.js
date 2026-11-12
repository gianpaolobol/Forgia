export default ({config}) => {
  const ca = process.env.FORGIA_LAN_PILOT_CA;
  if (!ca) return config;

  const endpoint = new URL(process.env.EXPO_PUBLIC_FORGIA_PILOT_URL ?? '');
  const octets = endpoint.hostname.split('.').map(Number);
  const [first, second] = octets;
  const privateIPv4 = octets.length === 4 && (first === 10 ||
    (first === 172 && second >= 16 && second <= 31) || (first === 192 && second === 168));
  if (endpoint.protocol !== 'https:' || !privateIPv4 || endpoint.origin !== endpoint.href.slice(0, -1)) {
    throw Error('Il certificato pilota richiede un’origine HTTPS IPv4 privata.');
  }
  return {
    ...config,
    android: {...config.android, package: 'it.gianpaolofranceschini.forgia.lanpilot'},
    ios: {...config.ios, infoPlist: {...config.ios?.infoPlist,
      NSAppTransportSecurity: {...config.ios?.infoPlist?.NSAppTransportSecurity, NSAllowsLocalNetworking: true},
      NSLocalNetworkUsageDescription: 'Forgia si collega al PC sulla rete locale durante il collaudo.'}},
    plugins: [...(config.plugins ?? []), ['./scripts/with-lan-pilot.cjs', {host: endpoint.hostname, ca}]],
  };
};
