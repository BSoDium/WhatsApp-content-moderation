import type { IncomingMessage } from 'node:http';

export interface TailscaleIdentity {
  login: string;
  name: string;
  pictureUrl: string | null;
  tailnet: string | null;
}

const ENCODED_WORD = /=\?utf-8\?([qb])\?([^?]*)\?=/gi;
const TAILNET_SUFFIX = '.ts.net';

// Tailscale Q-encodes non-ASCII values (Go's mime.QEncoding), so "Élodie" arrives as "=?utf-8?q?=C3=89lodie?=".
function decodeHeaderValue(value: string): string {
  return value.replace(ENCODED_WORD, (_match, encoding: string, payload: string) => {
    if (encoding.toLowerCase() === 'b') return Buffer.from(payload, 'base64').toString('utf8');
    const bytes = Buffer.from(payload.replace(/_/g, ' ').replace(/=([0-9a-f]{2})/gi, (_hex, code: string) => String.fromCharCode(parseInt(code, 16))), 'latin1');
    return bytes.toString('utf8');
  });
}

function headerValue(req: IncomingMessage, name: string): string | undefined {
  const value = req.headers[name];
  return typeof value === 'string' && value.length > 0 ? value : undefined;
}

// The proxied hostname is `<service>.<tailnet>.ts.net`; everything after the first label is the tailnet.
function tailnetFromForwardedHost(host: string | undefined): string | null {
  if (!host) return null;
  const hostname = host.split(':')[0].toLowerCase();
  if (!hostname.endsWith(TAILNET_SUFFIX)) return null;
  const [, ...rest] = hostname.split('.');
  return rest.length > 2 ? rest.join('.') : null;
}

function httpsUrlOrNull(value: string | undefined): string | null {
  if (!value) return null;
  try {
    return new URL(value).protocol === 'https:' ? value : null;
  } catch {
    return null;
  }
}

/**
 * Reads the display identity `tailscale serve` attaches to a proxied request.
 * Only meaningful after `verifyTailscaleIdentity` has accepted the request —
 * it carries no trust of its own. Returns null when the login header is
 * absent (tagged devices, Funnel, or a request that never went through Serve).
 */
export function readTailscaleIdentity(req: IncomingMessage): TailscaleIdentity | null {
  const login = headerValue(req, 'tailscale-user-login');
  if (!login) return null;
  const rawName = headerValue(req, 'tailscale-user-name');
  return {
    login: decodeHeaderValue(login),
    name: (rawName && decodeHeaderValue(rawName)) || decodeHeaderValue(login),
    pictureUrl: httpsUrlOrNull(headerValue(req, 'tailscale-user-profile-pic')),
    tailnet: tailnetFromForwardedHost(headerValue(req, 'x-forwarded-host')),
  };
}
