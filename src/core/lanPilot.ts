export function lanPilotOrigin(value: string): string | undefined {
  const match = /^https:\/\/(\d{1,3}(?:\.\d{1,3}){3})(?::([1-9]\d{0,4}))?\/?$/.exec(value.trim());
  if (!match) return;
  const [, address, port] = match;
  const octets = address.split('.').map(Number);
  if (octets.some((octet, index) => octet > 255 || String(octet) !== address.split('.')[index])) return;
  const [a, b] = octets;
  if (a !== 10 && !(a === 172 && b >= 16 && b <= 31) && !(a === 192 && b === 168)) return;
  if (port && Number(port) > 65535) return;
  return `https://${address}${port ? ':' + port : ''}`;
}

/** A configured URL alone never enables a native pilot. Web stays on loopback. */
export function pilotConnection(platform: string, iosFlag: string | undefined,
  androidFlag: string | undefined, configured: string | undefined, editable?: string) {
  const iosLanPilot = platform === 'ios' && iosFlag === '1';
  const androidLanPilot = platform === 'android' && androidFlag === '1';
  const nativePilot = iosLanPilot || androidLanPilot;
  const initialAddress = nativePilot ? lanPilotOrigin(configured ?? '') : undefined;
  const api = platform === 'web' ? 'http://127.0.0.1:8787'
    : iosLanPilot ? lanPilotOrigin(editable ?? initialAddress ?? '')
    : androidLanPilot ? initialAddress : undefined;
  return {iosLanPilot, nativePilot, initialAddress, api};
}
