import { createServer } from 'node:http';
import type { IncomingMessage, ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';
import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, extname, resolve } from 'node:path';
import pino from 'pino';
import { verifyTailscaleIdentity } from './tailscale-auth.ts';
import { NON_INDIVIDUAL_JID_SUFFIXES } from '../whatsapp/contact-directory.ts';
import type { createManualOverride } from '../override/manual-override.ts';
import type { createContactDirectory } from '../whatsapp/contact-directory.ts';
import type { listMonitored, getMonitored } from '../store/monitored-contacts.ts';

interface ControlServerDependencies {
  manualOverride: ReturnType<typeof createManualOverride>;
  contactDirectory: ReturnType<typeof createContactDirectory>;
  monitoredContacts: {
    list: typeof listMonitored;
    isMonitored: (contactId: string) => boolean;
    get: typeof getMonitored;
    add: (contactId: string) => void;
    remove: (contactId: string) => boolean;
    setEscalationEnabled: (contactId: string, enabled: boolean) => boolean;
  };
  allowedLogin: string;
}

const logger = pino({ name: 'control-server' });

const __dirname = dirname(fileURLToPath(import.meta.url));
const DIST_DIR = resolve(__dirname, '../../web/dist');

// Must stay loopback-only — see createControlServer's doc comment.
const LOOPBACK_HOST = '127.0.0.1';

type OverrideCommand = Parameters<ReturnType<typeof createManualOverride>['runCommand']>[1];
const COMMAND_ROUTES: ReadonlySet<OverrideCommand> = new Set(['pause', 'resume', 'unblock']);

function isOverrideCommand(action: string): action is OverrideCommand {
  return COMMAND_ROUTES.has(action as OverrideCommand);
}

const ASSET_CONTENT_TYPES: Record<string, string> = {
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.woff2': 'font/woff2',
  '.woff': 'font/woff',
};

// Read per-request, not cached at startup — see docs/decisions.md's "Control page styling". A single try/catch (not existsSync+readFileSync) avoids racing a concurrent `vite build --watch`.
function serveDistFile(res: ServerResponse, pathname: string): boolean {
  const filePath = resolve(DIST_DIR, `.${pathname}`);
  if (!filePath.startsWith(DIST_DIR + '/') && filePath !== DIST_DIR) return false;
  let body: Buffer;
  try {
    body = readFileSync(filePath);
  } catch (err) {
    if (err instanceof Error && 'code' in err && err.code === 'ENOENT') return false;
    throw err;
  }
  res.writeHead(200, { 'Content-Type': ASSET_CONTENT_TYPES[extname(filePath)] ?? 'application/octet-stream' });
  res.end(body);
  return true;
}

function sendJson(res: ServerResponse, status: number, body: unknown): void {
  const payload = JSON.stringify(body);
  res.writeHead(status, { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(payload) });
  res.end(payload);
}

function readJsonBody(req: IncomingMessage): Promise<unknown> {
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

// e.g. '/api/roster/15551234567%40s.whatsapp.net/pause' -> ['roster', '15551234567@s.whatsapp.net', 'pause'].
// Returns null for a non-/api/ path, or undefined for a malformed percent-encoded segment.
function apiSegments(pathname: string): string[] | null | undefined {
  const parts = pathname.split('/').filter(Boolean);
  if (parts[0] !== 'api') return null;
  try {
    return parts.slice(1).map(decodeURIComponent);
  } catch {
    return undefined;
  }
}

// CSRF guard (forces a CORS preflight on cross-origin requests) — see createControlServer's doc comment.
function hasJsonContentType(req: IncomingMessage): boolean {
  return req.headers['content-type']?.split(';')[0].trim() === 'application/json';
}

function requireJsonContentType(req: IncomingMessage, res: ServerResponse): boolean {
  if (hasJsonContentType(req)) return true;
  sendJson(res, 415, { error: 'Content-Type must be application/json' });
  return false;
}

async function readValidatedJsonBody(req: IncomingMessage, res: ServerResponse): Promise<unknown | undefined> {
  try {
    return await readJsonBody(req);
  } catch (err) {
    logger.warn({ error: err instanceof Error ? err.message : String(err) }, 'rejected: invalid JSON body');
    sendJson(res, 400, { error: 'invalid JSON body' });
    return undefined;
  }
}

function isIndividualJid(contactId: string): boolean {
  return !NON_INDIVIDUAL_JID_SUFFIXES.some((suffix) => contactId.endsWith(suffix));
}

function rosterEntry(
  { contactId, escalationEnabled }: { contactId: string; escalationEnabled: boolean },
  { contactDirectory, manualOverride }: Pick<ControlServerDependencies, 'contactDirectory' | 'manualOverride'>,
) {
  return {
    id: contactId,
    name: contactDirectory.get(contactId).name,
    escalationEnabled,
    ...manualOverride.getStatus(contactId),
  };
}

async function handleApi(
  req: IncomingMessage,
  res: ServerResponse,
  segments: string[],
  deps: ControlServerDependencies,
): Promise<boolean> {
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
    if (!requireJsonContentType(req, res)) return true;
    const body = await readValidatedJsonBody(req, res);
    if (body === undefined) return true;
    if (typeof body !== 'object' || body === null || !('contactId' in body) || typeof body.contactId !== 'string' || body.contactId.length === 0) {
      sendJson(res, 400, { error: 'contactId must be a non-empty string' });
      return true;
    }
    if (!isIndividualJid(body.contactId)) {
      sendJson(res, 400, { error: 'contactId must be an individual contact, not a group or broadcast list' });
      return true;
    }
    monitoredContacts.add(body.contactId);
    const contact = monitoredContacts.get(body.contactId);
    if (!contact) {
      sendJson(res, 500, { error: 'monitored contact could not be loaded' });
      return true;
    }
    sendJson(res, 201, rosterEntry(contact, deps));
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
    if (!contactId || !action) return false;

    if (isOverrideCommand(action)) {
      if (!monitoredContacts.isMonitored(contactId)) {
        sendJson(res, 404, { error: 'not monitored' });
        return true;
      }
      if (!requireJsonContentType(req, res)) return true;
      const message = await manualOverride.runCommand(contactId, action);
      sendJson(res, 200, { message, ...manualOverride.getStatus(contactId) });
      return true;
    }

    if (action === 'escalation') {
      if (!requireJsonContentType(req, res)) return true;
      const body = await readValidatedJsonBody(req, res);
      if (body === undefined) return true;
      if (typeof body !== 'object' || body === null || !('enabled' in body) || typeof body.enabled !== 'boolean') {
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

async function handleRequest(req: IncomingMessage, res: ServerResponse, deps: ControlServerDependencies): Promise<void> {
  const { allowedLogin } = deps;
  const { pathname } = new URL(req.url ?? '/', `http://${LOOPBACK_HOST}`);

  if (req.method === 'GET' && (pathname === '/favicon.svg' || pathname.startsWith('/assets/')) && serveDistFile(res, pathname)) {
    return;
  }

  if (!verifyTailscaleIdentity(req, allowedLogin)) {
    logger.warn({ login: req.headers['tailscale-user-login'] ?? null }, 'rejected: no matching Tailscale identity');
    sendJson(res, 403, { error: 'forbidden' });
    return;
  }

  const isRootPage = req.method === 'GET' && pathname === '/';
  if (isRootPage) {
    let indexHtml;
    try {
      indexHtml = readFileSync(resolve(DIST_DIR, 'index.html'), 'utf8');
    } catch (err) {
      logger.error({ error: err instanceof Error ? err.message : String(err) }, 'web/dist/index.html missing — run `npm run build:web`');
      sendJson(res, 503, { error: 'frontend not built' });
      return;
    }
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    res.end(indexHtml);
    return;
  }

  const segments = apiSegments(pathname);
  if (segments === undefined) {
    sendJson(res, 400, { error: 'malformed path' });
    return;
  }
  if (segments && (await handleApi(req, res, segments, deps))) return;

  sendJson(res, 404, { error: 'not found' });
}

/**
 * Creates the manual-override control server (issues #29, #32): a static
 * page plus a small JSON API in front of src/override/manual-override.ts's
 * routines, src/whatsapp/contact-directory.ts's known-contacts list, and
 * src/store/monitored-contacts.ts's roster.
 *
 * Auth is a single check, required on `GET /` and every `/api/*` route —
 * see docs/decisions.md "Web control app: back to trusting the header
 * (issue #29, twice revisited)": `verifyTailscaleIdentity` trusts the
 * `Tailscale-User-Login` header `tailscale serve` sets when proxying a
 * tailnet request to this app, checked against `allowedLogin`. No shared
 * secret, no cookie, no bootstrap step — a plain visit to the tailnet URL
 * just works, every time. **Deliberately single-factor**: an earlier
 * revision tried closing the local-forgery gap (any other process/user on
 * this host connecting to this port directly, since the loopback bind in
 * `listen()` stops only *remote* access) via tailscaled's LocalAPI `whois`,
 * but that doesn't work for a `tailscale serve`-proxied backend — see the
 * decisions.md entry for why. Accepted for a single-operator host where
 * the operator is the only account with shell access to the machine.
 *
 * `GET /assets/*` (the Vite-built frontend's JS/CSS/font bundle) is the sole
 * exception, checked before the identity check: none of these files
 * contain anything secret — see docs/decisions.md "Control page styling"
 * for the full reasoning.
 *
 * State-changing POSTs additionally require `Content-Type: application/json`
 * (a CSRF defense — see the inline comments at each check). `DELETE` doesn't
 * need the same check: unlike POST, DELETE isn't a CORS-safelisted method,
 * so a cross-origin request already forces a preflight regardless of
 * Content-Type. This server never sends `Access-Control-Allow-Origin`, so a
 * forced preflight blocks the real cross-origin request outright.
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
 *     get: (contactId: string) => { contactId: string, escalationEnabled: boolean } | undefined,
 *     add: (contactId: string) => void,
 *     remove: (contactId: string) => boolean,
 *     setEscalationEnabled: (contactId: string, enabled: boolean) => boolean,
 *   },
 *   allowedLogin: string,
 * }} deps
 * @returns {{ listen: (port: number) => Promise<number>, close: () => Promise<void> }}
 */
export function createControlServer(deps: ControlServerDependencies): { listen: (port: number) => Promise<number>; close: () => Promise<void> } {
  if (!existsSync(resolve(DIST_DIR, 'index.html'))) {
    throw new Error(`${DIST_DIR}/index.html not found — run \`npm run build:web\` before starting the server`);
  }

  const server = createServer((req, res) => {
    handleRequest(req, res, deps).catch((err) => {
      logger.error({ error: err instanceof Error ? err.message : String(err) }, 'request handler failed');
      if (!res.headersSent) sendJson(res, 500, { error: 'internal error' });
    });
  });

  return {
    listen: (port) =>
      new Promise<number>((resolve, reject) => {
        server.once('error', reject);
        server.listen(port, LOOPBACK_HOST, () => {
          server.removeListener('error', reject);
          const address = server.address();
          if (!address || typeof address === 'string') {
            reject(new Error('control server did not bind to a TCP address'));
            return;
          }
          const boundPort = (address as AddressInfo).port;
          logger.info({ port: boundPort }, `control server listening on ${LOOPBACK_HOST} (loopback only)`);
          resolve(boundPort);
        });
      }),
    close: () =>
      new Promise<void>((resolve) => {
        // See createControlServer's doc comment: force-close rather than wait for in-flight requests to finish.
        server.close(() => resolve());
        server.closeAllConnections();
      }),
  };
}
