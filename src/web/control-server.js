import { createServer } from 'node:http';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import pino from 'pino';
import { verifyTailscaleIdentity } from './tailscale-auth.js';
import { verifyControlToken } from './control-token-auth.js';

const logger = pino({ name: 'control-server' });

const __dirname = dirname(fileURLToPath(import.meta.url));
const INDEX_HTML = readFileSync(join(__dirname, 'index.html'), 'utf8');

// Must stay loopback-only — see createControlServer's doc comment.
const LOOPBACK_HOST = '127.0.0.1';

const COMMAND_ROUTES = { '/api/pause': 'pause', '/api/resume': 'resume', '/api/unblock': 'unblock' };

function sendJson(res, status, body) {
  const payload = JSON.stringify(body);
  res.writeHead(status, { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(payload) });
  res.end(payload);
}

async function handleRequest(req, res, { manualOverride, allowedLogin, controlToken }) {
  const { pathname, searchParams } = new URL(req.url, `http://${LOOPBACK_HOST}`);

  if (!verifyTailscaleIdentity(req, allowedLogin)) {
    logger.warn({ login: req.headers['tailscale-user-login'] ?? null }, 'rejected: no matching Tailscale identity');
    sendJson(res, 403, { error: 'forbidden' });
    return;
  }

  if (!verifyControlToken(req, searchParams, controlToken)) {
    logger.warn('rejected: missing or invalid control token');
    sendJson(res, 403, { error: 'forbidden' });
    return;
  }

  if (req.method === 'GET' && pathname === '/') {
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    res.end(INDEX_HTML);
    return;
  }

  if (req.method === 'GET' && pathname === '/api/status') {
    sendJson(res, 200, manualOverride.getStatus());
    return;
  }

  const command = req.method === 'POST' ? COMMAND_ROUTES[pathname] : undefined;
  if (command) {
    // CSRF guard (forces a CORS preflight on cross-origin requests) — see createControlServer's doc comment.
    const contentType = req.headers['content-type']?.split(';')[0].trim();
    if (contentType !== 'application/json') {
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
 * Auth is two factors, both required — see docs/decisions.md "Web control
 * app: Tailscale identity headers (issue #29)":
 * 1. A `Tailscale-User-Login` header matching `allowedLogin`, which
 *    `tailscale serve` sets when proxying a tailnet request in.
 * 2. A `controlToken` shared secret (via `X-Control-Token` header or a
 *    `token` query param), because the header alone is not proof the
 *    request actually came through `tailscale serve`'s proxy hop — the
 *    loopback bind in `listen()` stops *remote* access, but any other
 *    local process/user on this host can otherwise set that header
 *    directly. The token isn't derivable from anything Tailscale sets, so
 *    it closes that gap.
 *
 * State-changing endpoints (the /api/pause etc. POSTs) additionally
 * require `Content-Type: application/json`, which is a CSRF defense (see
 * the inline comment at that check) layered on top of, not instead of, the
 * two factors above.
 *
 * `close()` force-closes every connection (not just idle ones) rather than
 * waiting for in-flight requests to finish on their own, so a slow command
 * (e.g. /api/unblock awaiting WhatsApp) can never block shutdown.
 *
 * @param {{
 *   manualOverride: {
 *     isPaused: () => boolean,
 *     getStatus: () => object,
 *     runCommand: (command: string) => Promise<string | null>,
 *   },
 *   allowedLogin: string,
 *   controlToken: string,
 * }} deps
 * @returns {{ listen: (port: number) => Promise<number>, close: () => Promise<void> }}
 */
export function createControlServer({ manualOverride, allowedLogin, controlToken }) {
  const server = createServer((req, res) => {
    handleRequest(req, res, { manualOverride, allowedLogin, controlToken }).catch((err) => {
      logger.error({ error: err?.message ?? String(err) }, 'request handler failed');
      if (!res.headersSent) sendJson(res, 500, { error: 'internal error' });
    });
  });

  return {
    listen: (port) =>
      new Promise((resolve, reject) => {
        server.once('error', reject);
        server.listen(port, LOOPBACK_HOST, () => {
          server.removeListener('error', reject);
          const boundPort = server.address().port;
          logger.info({ port: boundPort }, `control server listening on ${LOOPBACK_HOST} (loopback only)`);
          resolve(boundPort);
        });
      }),
    close: () =>
      new Promise((resolve) => {
        // See createControlServer's doc comment: force-close rather than wait for in-flight requests to finish.
        server.close(() => resolve());
        server.closeAllConnections();
      }),
  };
}
