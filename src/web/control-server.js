import { createServer } from 'node:http';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import pino from 'pino';
import { verifyTailscaleIdentity } from './tailscale-auth.js';

const logger = pino({ name: 'control-server' });

const __dirname = dirname(fileURLToPath(import.meta.url));
const INDEX_HTML = readFileSync(join(__dirname, 'index.html'), 'utf8');

const COMMAND_ROUTES = { '/api/pause': 'pause', '/api/resume': 'resume', '/api/unblock': 'unblock' };

function sendJson(res, status, body) {
  const payload = JSON.stringify(body);
  res.writeHead(status, { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(payload) });
  res.end(payload);
}

async function handleRequest(req, res, { manualOverride, allowedLogin }) {
  if (!verifyTailscaleIdentity(req, allowedLogin)) {
    logger.warn({ login: req.headers['tailscale-user-login'] ?? null }, 'rejected: no matching Tailscale identity');
    sendJson(res, 403, { error: 'forbidden' });
    return;
  }

  const { method, url } = req;

  if (method === 'GET' && url === '/') {
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    res.end(INDEX_HTML);
    return;
  }

  if (method === 'GET' && url === '/api/status') {
    sendJson(res, 200, manualOverride.getStatus());
    return;
  }

  const command = method === 'POST' ? COMMAND_ROUTES[url] : undefined;
  if (command) {
    // Forces a CORS preflight on any cross-origin request; since this
    // server never sends Access-Control-Allow-Origin, the browser refuses
    // to send the real request — see this module's own doc comment below.
    if (req.headers['content-type'] !== 'application/json') {
      sendJson(res, 415, { error: 'Content-Type must be application/json' });
      return;
    }
    const message = await manualOverride.runCommand(command);
    sendJson(res, 200, { message, ...manualOverride.getStatus() });
    return;
  }

  sendJson(res, 404, { error: 'not found' });
}

/**
 * Creates the manual-override control server (issue #29): a static page
 * plus a small JSON API in front of src/override/manual-override.js's
 * routines.
 *
 * Every request must carry a `Tailscale-User-Login` header matching
 * `allowedLogin` — see docs/decisions.md "Web control app: Tailscale
 * identity headers (issue #29)" for the full design. That header is only
 * trustworthy because `listen()` hardcodes the loopback interface: this
 * server must be reachable *only* through `tailscale serve`'s local proxy
 * hop (which sets/sanitizes the header), never directly, or the header
 * becomes attacker-controlled input instead of an identity.
 *
 * State-changing endpoints (the /api/pause etc. POSTs) additionally
 * require `Content-Type: application/json`, which is this app's entire
 * CSRF defense — see the inline comment at that check.
 *
 * @param {{
 *   manualOverride: {
 *     isPaused: () => boolean,
 *     getStatus: () => object,
 *     runCommand: (command: string) => Promise<string | null>,
 *   },
 *   allowedLogin: string,
 * }} deps
 * @returns {{ listen: (port: number) => Promise<number>, close: () => Promise<void> }}
 */
export function createControlServer({ manualOverride, allowedLogin }) {
  const server = createServer((req, res) => {
    handleRequest(req, res, { manualOverride, allowedLogin }).catch((err) => {
      logger.error({ error: err?.message ?? String(err) }, 'request handler failed');
      if (!res.headersSent) sendJson(res, 500, { error: 'internal error' });
    });
  });

  return {
    listen: (port) =>
      new Promise((resolve, reject) => {
        server.once('error', reject);
        server.listen(port, '127.0.0.1', () => {
          server.removeListener('error', reject);
          const boundPort = server.address().port;
          logger.info({ port: boundPort }, 'control server listening on 127.0.0.1 (loopback only)');
          resolve(boundPort);
        });
      }),
    close: () => new Promise((resolve) => server.close(() => resolve())),
  };
}
