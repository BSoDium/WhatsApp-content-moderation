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

const COMMAND_ROUTES = new Set(['pause', 'resume', 'unblock']);

// Neither file contains a secret (the control token only ever lives in the
// browser's sessionStorage, never in served source), and a <link>/<script
// src> tag can't attach X-Control-Token the way fetch() can — so these two
// routes, and only these two, skip both auth factors. See
// docs/decisions.md "Control page styling".
const STATIC_ASSETS = {
  '/styles.css': { file: join(__dirname, 'styles.css'), contentType: 'text/css; charset=utf-8' },
  '/app.js': { file: join(__dirname, 'app.js'), contentType: 'text/javascript; charset=utf-8' },
};
const staticAssetBodies = Object.fromEntries(
  Object.entries(STATIC_ASSETS).map(([pathname, { file, contentType }]) => [pathname, { body: readFileSync(file, 'utf8'), contentType }]),
);

function sendJson(res, status, body) {
  const payload = JSON.stringify(body);
  res.writeHead(status, { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(payload) });
  res.end(payload);
}

function readJsonBody(req) {
  return new Promise((resolve, reject) => {
    let data = '';
    req.on('data', (chunk) => {
      data += chunk;
    });
    req.on('end', () => {
      if (!data) return resolve({});
      try {
        resolve(JSON.parse(data));
      } catch (err) {
        reject(err);
      }
    });
    req.on('error', reject);
  });
}

// e.g. '/api/roster/15551234567%40s.whatsapp.net/pause' -> ['roster', '15551234567@s.whatsapp.net', 'pause']
function apiSegments(pathname) {
  const parts = pathname.split('/').filter(Boolean);
  return parts[0] === 'api' ? parts.slice(1).map(decodeURIComponent) : null;
}

// CSRF guard (forces a CORS preflight on cross-origin requests) — see createControlServer's doc comment.
function hasJsonContentType(req) {
  return req.headers['content-type']?.split(';')[0].trim() === 'application/json';
}

function rosterEntry({ contactId, escalationEnabled }, { contactDirectory, manualOverride }) {
  return {
    id: contactId,
    name: contactDirectory.get(contactId).name,
    escalationEnabled,
    ...manualOverride.getStatus(contactId),
  };
}

async function handleApi(req, res, segments, deps) {
  const { manualOverride, contactDirectory, monitoredContacts } = deps;

  if (req.method === 'GET' && segments.length === 1 && segments[0] === 'contacts') {
    const contacts = contactDirectory.list().map((c) => ({ ...c, monitored: monitoredContacts.isMonitored(c.id) }));
    sendJson(res, 200, contacts);
    return true;
  }

  if (segments[0] !== 'roster') return false;

  if (req.method === 'GET' && segments.length === 1) {
    sendJson(res, 200, monitoredContacts.list().map((row) => rosterEntry(row, deps)));
    return true;
  }

  if (req.method === 'POST' && segments.length === 1) {
    if (!hasJsonContentType(req)) {
      sendJson(res, 415, { error: 'Content-Type must be application/json' });
      return true;
    }
    let body;
    try {
      body = await readJsonBody(req);
    } catch {
      sendJson(res, 400, { error: 'invalid JSON body' });
      return true;
    }
    if (typeof body.contactId !== 'string' || body.contactId.length === 0) {
      sendJson(res, 400, { error: 'contactId must be a non-empty string' });
      return true;
    }
    monitoredContacts.add(body.contactId);
    const row = monitoredContacts.list().find((r) => r.contactId === body.contactId);
    sendJson(res, 201, rosterEntry(row, deps));
    return true;
  }

  if (segments.length === 2 && req.method === 'DELETE') {
    const removed = monitoredContacts.remove(segments[1]);
    if (!removed) {
      sendJson(res, 404, { error: 'not monitored' });
      return true;
    }
    sendJson(res, 200, { removed: true });
    return true;
  }

  if (segments.length === 3 && req.method === 'POST') {
    const [, contactId, action] = segments;

    if (COMMAND_ROUTES.has(action)) {
      if (!hasJsonContentType(req)) {
        sendJson(res, 415, { error: 'Content-Type must be application/json' });
        return true;
      }
      const message = await manualOverride.runCommand(contactId, action);
      sendJson(res, 200, { message, ...manualOverride.getStatus(contactId) });
      return true;
    }

    if (action === 'escalation') {
      if (!hasJsonContentType(req)) {
        sendJson(res, 415, { error: 'Content-Type must be application/json' });
        return true;
      }
      let body;
      try {
        body = await readJsonBody(req);
      } catch {
        sendJson(res, 400, { error: 'invalid JSON body' });
        return true;
      }
      if (typeof body.enabled !== 'boolean') {
        sendJson(res, 400, { error: 'enabled must be a boolean' });
        return true;
      }
      const updated = monitoredContacts.setEscalationEnabled(contactId, body.enabled);
      if (!updated) {
        sendJson(res, 404, { error: 'not monitored' });
        return true;
      }
      sendJson(res, 200, { escalationEnabled: body.enabled });
      return true;
    }
  }

  return false;
}

async function handleRequest(req, res, deps) {
  const { allowedLogin, controlToken } = deps;
  const { pathname, searchParams } = new URL(req.url, `http://${LOOPBACK_HOST}`);

  if (req.method === 'GET' && staticAssetBodies[pathname]) {
    const { body, contentType } = staticAssetBodies[pathname];
    res.writeHead(200, { 'Content-Type': contentType });
    res.end(body);
    return;
  }

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

  const segments = apiSegments(pathname);
  if (segments && (await handleApi(req, res, segments, deps))) return;

  sendJson(res, 404, { error: 'not found' });
}

/**
 * Creates the manual-override control server (issues #29, #32): a static
 * page plus a small JSON API in front of src/override/manual-override.js's
 * routines, src/whatsapp/contact-directory.js's known-contacts list, and
 * src/store/monitored-contacts.js's roster.
 *
 * Auth is two factors, both required on `GET /` and every `/api/*` route —
 * see docs/decisions.md "Web control app: Tailscale identity headers (issue
 * #29)":
 * 1. A `Tailscale-User-Login` header matching `allowedLogin`, which
 *    `tailscale serve` sets when proxying a tailnet request to a local port.
 * 2. A `controlToken` shared secret (via `X-Control-Token` header or a
 *    `token` query param), because the header alone is not proof the
 *    request actually came through `tailscale serve`'s proxy hop — the
 *    loopback bind in `listen()` stops *remote* access, but any other
 *    local process/user on this host can otherwise set that header
 *    directly. The token isn't derivable from anything Tailscale sets, so
 *    it closes that gap.
 *
 * `GET /styles.css` and `GET /app.js` are the sole exception, checked
 * before either factor — see docs/decisions.md for why that's safe.
 *
 * State-changing POSTs additionally require `Content-Type: application/json`
 * (a CSRF defense — see the inline comments at each check). `DELETE` doesn't
 * need the same check: unlike POST, DELETE isn't a CORS-safelisted method,
 * so a cross-origin request already forces a preflight regardless of
 * Content-Type.
 *
 * `close()` force-closes every connection (not just idle ones) rather than
 * waiting for in-flight requests to finish on their own, so a slow command
 * (e.g. an unblock awaiting WhatsApp) can never block shutdown.
 *
 * @param {{
 *   manualOverride: {
 *     isPaused: (contactId: string) => boolean,
 *     getStatus: (contactId: string) => object,
 *     runCommand: (contactId: string, command: string) => Promise<string | null>,
 *   },
 *   contactDirectory: { list: () => object[], get: (contactId: string) => object },
 *   monitoredContacts: {
 *     list: () => { contactId: string, escalationEnabled: boolean }[],
 *     isMonitored: (contactId: string) => boolean,
 *     add: (contactId: string) => void,
 *     remove: (contactId: string) => boolean,
 *     setEscalationEnabled: (contactId: string, enabled: boolean) => boolean,
 *   },
 *   allowedLogin: string,
 *   controlToken: string,
 * }} deps
 * @returns {{ listen: (port: number) => Promise<number>, close: () => Promise<void> }}
 */
export function createControlServer(deps) {
  const server = createServer((req, res) => {
    handleRequest(req, res, deps).catch((err) => {
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
