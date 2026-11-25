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
