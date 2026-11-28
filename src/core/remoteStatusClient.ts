// Loopback-only operator client. Do not use as a private-network transport:
// pairing, TLS, MFA, and secure credential storage are separate F09 gates.
export type RemoteStatus = {node: string; online: boolean; lastSeenAt: number | null};

export async function readRemoteNodeStatus(port: number, token: string, fetcher: typeof fetch = fetch): Promise<RemoteStatus> {
  if (!Number.isInteger(port) || port < 1 || port > 65535 || port === 8787 ||
      typeof token !== 'string' || !/^[a-f0-9]{64}$/.test(token)) throw Error('Invalid remote status configuration');
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 5000);
  try {
    const response = await fetcher('http://127.0.0.1:'+port+'/v1/status', {
      method:'GET', headers:{Authorization:'Bearer '+token,Accept:'application/json'},
      redirect:'error', cache:'no-store', credentials:'omit', signal:controller.signal,
    });
    if (response.redirected || response.status !== 200 ||
        response.headers.get('content-type') !== 'application/json; charset=utf-8') throw Error('status');
    const body = await response.text();
    if (body.length > 1024) throw Error('status');
    const value: unknown = JSON.parse(body);
    if (!value || typeof value !== 'object' || Array.isArray(value) ||
        Object.keys(value).length !== 3 || !('node' in value) ||
        typeof value.node !== 'string' || !/^[a-z0-9][a-z0-9_-]{0,63}$/.test(value.node) ||
        !('online' in value) || typeof value.online !== 'boolean' ||
        !('lastSeenAt' in value) ||
        (value.lastSeenAt !== null && (typeof value.lastSeenAt !== 'number' ||
        !Number.isSafeInteger(value.lastSeenAt) || value.lastSeenAt < 0)) ||
        (value.online && value.lastSeenAt === null)) throw Error('status');
    return {node:value.node,online:value.online,lastSeenAt:value.lastSeenAt};
  } catch {
    // A network failure, denial or malformed result is NOT an offline node.
    // Never echo bearer credentials or arbitrary response text.
    throw Error('Remote node status unavailable');
  } finally { clearTimeout(timer); }
}
