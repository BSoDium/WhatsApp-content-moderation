import { createServer } from 'node:http';
import type { IncomingMessage, ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';
import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, extname, resolve } from 'node:path';
import pino from 'pino';
import { verifyTailscaleIdentity } from './tailscale-auth.ts';
import { onControlEvent } from '../store/events.ts';
import { NON_INDIVIDUAL_JID_SUFFIXES } from '../whatsapp/contact-directory.ts';
import type { createManualOverride } from '../override/manual-override.ts';
import type { createContactDirectory } from '../whatsapp/contact-directory.ts';
import type { createProfilePhotos } from '../whatsapp/profile-photos.ts';
import type { listMonitored, getMonitored } from '../store/monitored-contacts.ts';
import type { AuditLogPageFilter, AuditLogStats } from '../store/audit-log.ts';
import type { AuditLogRecord } from '../types.ts';
import { getPolicyText, setPolicyText } from '../classifier/policy.ts';
import { listSettings, setSetting } from '../store/settings.ts';

interface ControlServerDependencies {
  manualOverride: ReturnType<typeof createManualOverride>;
  contactDirectory: ReturnType<typeof createContactDirectory>;
  profilePhotos: ReturnType<typeof createProfilePhotos>;
  monitoredContacts: {
    list: typeof listMonitored;
    isMonitored: (contactId: string) => boolean;
    get: typeof getMonitored;
    add: (contactId: string) => void;
    remove: (contactId: string) => boolean;
    setEscalationEnabled: (contactId: string, enabled: boolean) => boolean;
    setContext: (contactId: string, context: string | null) => boolean;
  };
  auditLog: {
    getPage: (filter: AuditLogPageFilter) => AuditLogRecord[];
    getStats: () => AuditLogStats;
  };
  blocks: {
    countActive: () => number;
  };
  allowedLogin: string;
  // The account's own contact_id (canonicalized the same way the directory
  // is), and whether TEST_ALLOW_SELF is enabled — together these let the
  // control app show the self contact as non-moderatable rather than a
  // switch that silently does nothing (or, outside shadow mode, moderates
  // the operator's own messages). A function, not a plain string: it's
  // unknown until the WhatsApp socket connects, sometime after this server
  // itself starts listening.
  getSelfId: () => string | null;
  allowSelf: boolean;
}

const logger = pino({ name: 'control-server' });

const __dirname = dirname(fileURLToPath(import.meta.url));
const DIST_DIR = resolve(__dirname, '../../web/dist');

// Must stay loopback-only — see createControlServer's doc comment.
const LOOPBACK_HOST = '127.0.0.1';

const DEFAULT_AUDIT_LOG_LIMIT = 50;
const MAX_AUDIT_LOG_LIMIT = 200;
// A generous ceiling on a contact's moderation-context textarea — real
// guidance, not a payload budget (see MAX_JSON_BODY_BYTES below for that).
const MAX_CONTEXT_LENGTH = 10_000;
// Same idea for the global policy editor.
const MAX_POLICY_LENGTH = 50_000;
// Keeps an SSE connection from being silently killed by an idle-connection
// timeout on the Tailscale Serve proxy in front of this server, well under
// any reasonable such timeout.
const SSE_HEARTBEAT_MS = 25_000;
// Short relative to profile-photos.ts's refresh window: the photo URL's
// `?v=` already busts this on every server-side refresh, so this only
// bounds how long a photo changed without one can linger in the browser.
const PHOTO_BROWSER_CACHE_SECONDS = 3600;

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

// Only the image bytes and a content type WhatsApp's CDN response was
// already checked against (photo-download.ts) — never its URL or headers.
function sendPhoto(res: ServerResponse, { body, contentType }: { body: Buffer; contentType: string }): void {
  res.writeHead(200, {
    'Content-Type': contentType,
    'Content-Length': body.length,
    'Cache-Control': `private, max-age=${PHOTO_BROWSER_CACHE_SECONDS}`,
    'X-Content-Type-Options': 'nosniff',
  });
  res.end(body);
}

function sendJson(res: ServerResponse, status: number, body: unknown): void {
  const payload = JSON.stringify(body);
  res.writeHead(status, { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(payload) });
  res.end(payload);
}

// Most bodies this server accepts are a handful of fields (a contactId
// string, an `enabled` boolean); the policy/context editors are the
// exception, up to MAX_POLICY_LENGTH characters of free text. This ceiling
// is comfortably above that (worst case, multi-byte UTF-8) — a defense
// against a request (from any other local process; this port is
// loopback-only but not restricted to this app — see createControlServer's
// doc comment) that never stops sending data, not a real payload budget.
const MAX_JSON_BODY_BYTES = 262_144;

class PayloadTooLargeError extends Error {}

function readJsonBody(req: IncomingMessage): Promise<unknown> {
  return new Promise((resolve, reject) => {
    let data = '';
    let bytes = 0;
    req.on('data', (chunk: Buffer) => {
      bytes += chunk.length;
      if (bytes > MAX_JSON_BODY_BYTES) {
        req.destroy();
        reject(new PayloadTooLargeError(`request body exceeded ${MAX_JSON_BODY_BYTES} bytes`));
        return;
      }
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
    if (err instanceof PayloadTooLargeError) {
      logger.warn({ error: err.message }, 'rejected: request body too large');
      sendJson(res, 413, { error: 'request body too large' });
      return undefined;
    }
    logger.warn({ error: err instanceof Error ? err.message : String(err) }, 'rejected: invalid JSON body');
    sendJson(res, 400, { error: 'invalid JSON body' });
    return undefined;
  }
}

function isIndividualJid(contactId: string): boolean {
  return !NON_INDIVIDUAL_JID_SUFFIXES.some((suffix) => contactId.endsWith(suffix));
}

function rosterEntry(
  { contactId, escalationEnabled, context }: { contactId: string; escalationEnabled: boolean; context: string | null },
  { contactDirectory, manualOverride }: Pick<ControlServerDependencies, 'contactDirectory' | 'manualOverride'>,
) {
  return {
    id: contactId,
    name: contactDirectory.get(contactId).name,
    escalationEnabled,
    context,
    ...manualOverride.getStatus(contactId),
  };
}

// snake_case DB row -> camelCase API shape, matching every other endpoint's convention.
function auditLogEntry(row: AuditLogRecord, contactName: string) {
  return {
    id: row.id,
    contactId: row.contact_id,
    contactName,
    direction: row.direction,
    message: row.message,
    classificationOk: Boolean(row.classification_ok),
    flagged: row.flagged === null ? null : Boolean(row.flagged),
    category: row.category,
    reason: row.reason,
    error: row.error,
    action: row.action,
    createdAt: row.created_at,
  };
}

// Clamped so a malformed/huge ?limit= can't force an unbounded query.
function clampAuditLogLimit(raw: string | null): number {
  const parsed = Number(raw);
  if (!raw || !Number.isInteger(parsed) || parsed <= 0) return DEFAULT_AUDIT_LOG_LIMIT;
  return Math.min(parsed, MAX_AUDIT_LOG_LIMIT);
}

// Malformed/missing `before` is treated as "no cursor" instead of binding NaN into `id < ?`, which SQLite accepts but which always evaluates false.
function parseAuditLogCursor(raw: string | null): number | undefined {
  if (!raw) return undefined;
  const parsed = Number(raw);
  return Number.isInteger(parsed) ? parsed : undefined;
}

async function handleApi(
  req: IncomingMessage,
  res: ServerResponse,
  segments: string[],
  searchParams: URLSearchParams,
  deps: ControlServerDependencies,
): Promise<boolean> {
  const { manualOverride, contactDirectory, profilePhotos, monitoredContacts, auditLog, blocks } = deps;

  // Server-Sent Events: pushes a `data: <topic>` line whenever contacts,
  // the roster, or the audit log changes (see src/store/events.ts), so the
  // control app can refetch immediately instead of waiting for its
  // fallback poll. One-way and text-only, so plain SSE over this server's
  // existing http.Server needs no extra dependency or protocol upgrade —
  // unlike a WebSocket, it also reconnects on its own via the browser's
  // built-in EventSource.
  if (req.method === 'GET' && segments.length === 1 && segments[0] === 'events') {
    res.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      Connection: 'keep-alive',
      'X-Accel-Buffering': 'no',
    });
    res.write(':ok\n\n');
    const unsubscribe = onControlEvent((topic) => res.write(`data: ${topic}\n\n`));
    const heartbeat = setInterval(() => res.write(':hb\n\n'), SSE_HEARTBEAT_MS);
    req.on('close', () => {
      clearInterval(heartbeat);
      unsubscribe();
    });
    return true;
  }

  if (req.method === 'GET' && segments.length === 1 && segments[0] === 'contacts') {
    const selfId = deps.getSelfId();
    const contacts = contactDirectory.list().map((c) => ({
      ...c,
      monitored: monitoredContacts.isMonitored(c.id),
      isSelf: c.id === selfId,
      allowSelf: deps.allowSelf,
      photoUrl: profilePhotos.photoPath(c.id),
    }));
    sendJson(res, 200, contacts);
    return true;
  }

  // A failed lookup/download is a 404 too, not a 5xx: either way the
  // frontend's only move is falling back to initials, and profile-photos.ts
  // has already logged why.
  if (req.method === 'GET' && segments.length === 3 && segments[0] === 'contacts' && segments[2] === 'photo') {
    const contactId = segments[1];
    const result = isIndividualJid(contactId) ? await profilePhotos.getPhoto(contactId) : { ok: true as const, photo: null };
    if (!result.ok || !result.photo) {
      sendJson(res, 404, { error: 'no photo' });
      return true;
    }
    sendPhoto(res, result.photo);
    return true;
  }

  if (req.method === 'GET' && segments.length === 1 && segments[0] === 'stats') {
    sendJson(res, 200, {
      monitoredCount: monitoredContacts.list().length,
      activeBlocks: blocks.countActive(),
      ...auditLog.getStats(),
    });
    return true;
  }

  if (req.method === 'GET' && segments.length === 1 && segments[0] === 'audit-log') {
    const limit = clampAuditLogLimit(searchParams.get('limit'));
    // Fetch one extra row so a page that exactly fills `limit` can be told apart from
    // one that's actually the last page, instead of always assuming there's a next page.
    const rows = auditLog.getPage({
      contactId: searchParams.get('contactId') ?? undefined,
      action: searchParams.get('action') ?? undefined,
      search: searchParams.get('search') ?? undefined,
      before: parseAuditLogCursor(searchParams.get('before')),
      limit: limit + 1,
    });
    const hasMore = rows.length > limit;
    const pageRows = hasMore ? rows.slice(0, limit) : rows;
    const contactNames = new Map<string, string>();
    const contactName = (contactId: string): string => {
      let name = contactNames.get(contactId);
      if (name === undefined) {
        name = contactDirectory.get(contactId).name;
        contactNames.set(contactId, name);
      }
      return name;
    };
    const entries = pageRows.map((row) => auditLogEntry(row, contactName(row.contact_id)));
    const nextBefore = hasMore ? pageRows[pageRows.length - 1].id : null;
    sendJson(res, 200, { entries, nextBefore });
    return true;
  }

  if (req.method === 'GET' && segments.length === 1 && segments[0] === 'policy') {
    sendJson(res, 200, { text: getPolicyText() });
    return true;
  }

  if (req.method === 'POST' && segments.length === 1 && segments[0] === 'policy') {
    if (!requireJsonContentType(req, res)) return true;
    const body = await readValidatedJsonBody(req, res);
    if (body === undefined) return true;
    if (typeof body !== 'object' || body === null || !('text' in body) || typeof body.text !== 'string') {
      sendJson(res, 400, { error: 'text must be a string' });
      return true;
    }
    if (body.text.length > MAX_POLICY_LENGTH) {
      sendJson(res, 400, { error: `text must be at most ${MAX_POLICY_LENGTH} characters` });
      return true;
    }
    const result = setPolicyText(body.text);
    if (!result.ok) {
      sendJson(res, 400, { error: result.error });
      return true;
    }
    sendJson(res, 200, { text: getPolicyText() });
    return true;
  }

  if (req.method === 'GET' && segments.length === 1 && segments[0] === 'settings') {
    sendJson(res, 200, listSettings());
    return true;
  }

  if (req.method === 'POST' && segments.length === 2 && segments[0] === 'settings') {
    if (!requireJsonContentType(req, res)) return true;
    const body = await readValidatedJsonBody(req, res);
    if (body === undefined) return true;
    if (typeof body !== 'object' || body === null || !('value' in body) || typeof body.value !== 'string') {
      sendJson(res, 400, { error: 'value must be a string' });
      return true;
    }
    const result = setSetting(segments[1], body.value);
    if (!result.ok) {
      sendJson(res, 400, { error: result.error });
      return true;
    }
    sendJson(res, 200, { key: segments[1], value: body.value });
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
    if (!deps.allowSelf && body.contactId === deps.getSelfId()) {
      sendJson(res, 400, { error: 'Moderating your own account is disabled — set TEST_ALLOW_SELF=1 to enable it for testing' });
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

    if (action === 'context') {
      if (!requireJsonContentType(req, res)) return true;
      const body = await readValidatedJsonBody(req, res);
      if (body === undefined) return true;
      if (typeof body !== 'object' || body === null || !('context' in body) || typeof body.context !== 'string') {
        sendJson(res, 400, { error: 'context must be a string' });
        return true;
      }
      if (body.context.length > MAX_CONTEXT_LENGTH) {
        sendJson(res, 400, { error: `context must be at most ${MAX_CONTEXT_LENGTH} characters` });
        return true;
      }
      const updated = monitoredContacts.setContext(contactId, body.context);
      if (!updated) {
        sendJson(res, 404, { error: 'not monitored' });
        return true;
      }
      sendJson(res, 200, { context: monitoredContacts.get(contactId)?.context ?? null });
      return true;
    }
  }

  return false;
}

async function handleRequest(req: IncomingMessage, res: ServerResponse, deps: ControlServerDependencies): Promise<void> {
  const { allowedLogin } = deps;
  const { pathname, searchParams } = new URL(req.url ?? '/', `http://${LOOPBACK_HOST}`);

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
  if (segments && (await handleApi(req, res, segments, searchParams, deps))) return;

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
 *   profilePhotos: {
 *     photoPath: (contactId: string) => string | null,
 *     getPhoto: (contactId: string) => Promise<{ ok: true, photo: { body: Buffer, contentType: string } | null } | { ok: false, error: string }>,
 *   },
 *   monitoredContacts: {
 *     list: () => { contactId: string, escalationEnabled: boolean, context: string | null }[],
 *     isMonitored: (contactId: string) => boolean,
 *     get: (contactId: string) => { contactId: string, escalationEnabled: boolean, context: string | null } | undefined,
 *     add: (contactId: string) => void,
 *     remove: (contactId: string) => boolean,
 *     setEscalationEnabled: (contactId: string, enabled: boolean) => boolean,
 *     setContext: (contactId: string, context: string | null) => boolean,
 *   },
 *   auditLog: { getPage: (filter: object) => object[], getStats: () => object },
 *   blocks: { countActive: () => number },
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
