import { request } from 'node:http';
import pino from 'pino';

const logger = pino({ name: 'tailscale-whois-auth' });

// tailscaled's LocalAPI is a Unix-socket-only HTTP API; this is its default
// path on Linux. Overridable for deployments that run tailscaled with a
// non-default --socket. Read as a default here (not cached), so tests can
// inject a fake socket per call via verifyTailscaleWhoIs's deps param
// instead of racing module-load-time env var reads.
const DEFAULT_TAILSCALED_SOCKET = '/var/run/tailscale/tailscaled.sock';
const TAILSCALED_SOCKET = process.env.TAILSCALED_SOCKET ?? DEFAULT_TAILSCALED_SOCKET;

// The LocalAPI never resolves this hostname (it's a Unix socket request),
// but Node's http.request requires some Host value.
const LOCALAPI_HOST = 'local-tailscaled.sock';

const DEFAULT_WHOIS_TIMEOUT_MS = 2_000;
const WHOIS_TIMEOUT_MS = Number(process.env.TAILSCALED_WHOIS_TIMEOUT_MS ?? DEFAULT_WHOIS_TIMEOUT_MS);

interface WhoIsResponse {
  UserProfile?: { LoginName?: string };
}

function fetchWhoIs(addr: string, socketPath: string): Promise<WhoIsResponse | undefined> {
  return new Promise((resolve) => {
    const req = request(
      {
        socketPath,
        host: LOCALAPI_HOST,
        path: `/localapi/v0/whois?addr=${encodeURIComponent(addr)}`,
        method: 'GET',
        timeout: WHOIS_TIMEOUT_MS,
      },
      (res) => {
        let body = '';
        res.setEncoding('utf8');
        res.on('data', (chunk: string) => {
          body += chunk;
        });
        res.on('end', () => {
          if (res.statusCode !== 200) {
            logger.warn({ statusCode: res.statusCode }, 'whois lookup rejected by tailscaled');
            resolve(undefined);
            return;
          }
          try {
            resolve(JSON.parse(body));
          } catch (err) {
            logger.warn({ error: err instanceof Error ? err.message : String(err) }, 'whois response was not valid JSON');
            resolve(undefined);
          }
        });
      },
    );
    req.on('timeout', () => req.destroy(new Error('whois request timed out')));
    req.on('error', (err) => {
      logger.warn({ error: err.message, socket: socketPath }, 'whois request to tailscaled failed');
      resolve(undefined);
    });
    req.end();
  });
}

/**
 * Verifies the caller's Tailscale identity by asking tailscaled's local API
 * who actually owns the TCP connection this request arrived on, instead of
 * trusting a header set by an intermediary — see docs/decisions.md "Web
 * control app: replacing the header+token with LocalAPI WhoIs (issue #29
 * revisited)" for why this needs no shared secret: when `tailscale serve`
 * proxies a real tailnet request to this app, tailscaled itself opens the
 * backend connection and remembers which tailnet peer it's carrying. A
 * locally-forged connection (any other process on this host connecting to
 * this port directly) gets its own ephemeral port that tailscaled has no
 * record of, so `whois` on it fails closed rather than succeeding.
 *
 * Every failure mode — socket unreachable, non-200, malformed body, no
 * profile, mismatched login — resolves to `false`. Never throws past this
 * boundary, never defaults to true.
 *
 * @param {string} remoteAddr
 * @param {number} remotePort
 * @param {string} allowedLogin
 * @param {{ socketPath?: string }} [deps] - `socketPath` in place of the
 *   real tailscaled socket, for tests.
 * @returns {Promise<boolean>}
 */
export async function verifyTailscaleWhoIs(
  remoteAddr: string,
  remotePort: number,
  allowedLogin: string,
  { socketPath = TAILSCALED_SOCKET }: { socketPath?: string } = {},
): Promise<boolean> {
  if (!remoteAddr || !remotePort) return false;

  const response = await fetchWhoIs(`${remoteAddr}:${remotePort}`, socketPath);
  const login = response?.UserProfile?.LoginName;

  if (!login) {
    logger.warn('rejected: whois returned no identity for this connection');
    return false;
  }
  if (login !== allowedLogin) {
    logger.warn({ login }, 'rejected: whois identity does not match allowed login');
    return false;
  }
  return true;
}
