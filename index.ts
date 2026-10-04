import { createLogger } from './src/cli/logger.ts';
import { connectWhatsApp } from './src/whatsapp/connection.ts';
import { getConnectionState, setConnectionState } from './src/whatsapp/connection-state.ts';
import { createMessageBuffer } from './src/buffer/message-buffer.ts';
import { handleBurst, pendingBursts } from './src/pipeline/moderation-pipeline.ts';
import { handleCallEvent, pendingCallEvents } from './src/pipeline/call-pipeline.ts';
import { startUnblockScheduler } from './src/pipeline/unblock-scheduler.ts';
import { extractIncomingMessage } from './src/pipeline/incoming-message.ts';
import { extractEditedMessage } from './src/pipeline/edited-message.ts';
import { extractOutgoingMessage, recordOutgoingMessage } from './src/pipeline/outgoing-message.ts';
import { createManualOverride } from './src/override/manual-override.ts';
import { createContactDirectory, canonicalContactId, canonicalMessageContactId } from './src/whatsapp/contact-directory.ts';
import { attachBlocklistSync } from './src/whatsapp/blocklist-sync.ts';
import { createProfilePhotos } from './src/whatsapp/profile-photos.ts';
import { createControlServer, getControlAppUrl } from './src/web/control-server.ts';
import { printWarningBanner, printSuccessBanner } from './src/cli/terminal-output.ts';
import { closeDb } from './src/store/db.ts';
import { ensureDefaultsSeeded, migrateShadowModeFromEnv, normalizeLegacyBoolSettings } from './src/store/settings.ts';
import {
  listMonitored,
  isMonitored,
  getMonitored,
  addMonitored,
  removeMonitored,
  setEscalationEnabled,
  setContext,
  setCallNuisanceThreshold,
  setBlockBackoffMax,
} from './src/store/monitored-contacts.ts';
import { getAuditLogPage, getAuditLogStats } from './src/store/audit-log.ts';
import { countActiveBlocks } from './src/store/blocks.ts';
import { deleteForMe, sendWarning, block, unblock, rejectCall } from './src/whatsapp/actions.ts';
import type { WASocket } from '@whiskeysockets/baileys';
import type { IncomingMessage } from './src/types.ts';

const AUTH_DIR = './auth_info';
const QR_PNG_PATH = './auth_info/login-qr.png';
// No second number handy? Set TEST_ALLOW_SELF=1 — see README "Testing each layer in isolation".
const ALLOW_SELF = process.env.TEST_ALLOW_SELF === '1';
// The control app is always on — see README "Web control app". Port only,
// not whether to start it: unlike every moderation-tuning knob, this has to
// be known before the settings store even exists.
const DEFAULT_CONTROL_PORT = 4756;
const RAW_CONTROL_PORT = process.env.CONTROL_PORT;
const CONTROL_PORT = RAW_CONTROL_PORT ? Number(RAW_CONTROL_PORT) : DEFAULT_CONTROL_PORT;
// Optional: restricts the control app to one Tailscale identity, proxied via
// `tailscale serve` — see README. Left unset, the app binds every interface
// and skips the identity check instead of refusing to start. Trimmed and
// treated as unset when blank, so a set-but-empty value (an unresolved
// template variable, an unset CI secret that resolves to "") never lands in
// the no-auth/all-interfaces branch while looking configured.
const ALLOWED_TAILSCALE_LOGIN = process.env.ALLOWED_TAILSCALE_LOGIN?.trim() || undefined;

if (RAW_CONTROL_PORT && (!Number.isInteger(CONTROL_PORT) || CONTROL_PORT <= 0)) {
  console.error(`CONTROL_PORT must be a positive integer, got: ${RAW_CONTROL_PORT}`);
  process.exit(1);
}

if (!ALLOWED_TAILSCALE_LOGIN) {
  // Deliberately a plain, unmissable banner rather than a structured pino
  // log line: this app no longer refuses to start over a missing Tailscale
  // login (see control-server.ts), and the packaged compose.yml
  // ships with ALLOWED_TAILSCALE_LOGIN commented out — a JSON log line
  // alone is easy to scroll past in `docker compose logs`.
  printWarningBanner([
    '!! ALLOWED_TAILSCALE_LOGIN is not set.',
    '!! The control app is reachable, unauthenticated, by anyone on your local network.',
    '!! Set ALLOWED_TAILSCALE_LOGIN to restrict it to one Tailscale identity — see the README.',
  ]);
}

const logger = createLogger('index');

let sock: WASocket | undefined;
let blocklistSync: ReturnType<typeof attachBlocklistSync> | undefined;

function currentSocket(): WASocket {
  if (!sock) throw new Error('WhatsApp socket is not connected');
  return sock;
}

// Unknown until the socket connects, sometime after createControlServer()
// itself starts listening — a closure over the outer `sock`, like
// currentSocket() above, rather than a value resolved once at startup.
function selfContactId(): string | null {
  return sock?.user ? canonicalContactId(sock.user) : null;
}

const buffer = createMessageBuffer<IncomingMessage>(async (contactId, messages) => {
  try {
    const { strikeCount } = await handleBurst(
      { contactId, messages },
      {
        deleteForMe: (jid, key, timestamp) => deleteForMe(currentSocket(), jid, key, timestamp),
        sendWarning: (jid, text) => sendWarning(currentSocket(), jid, text),
        block: (jid) => block(currentSocket(), jid),
        isPaused: (jid) => manualOverride.isPaused(jid),
      },
    );
    logger.info({ contactId, strikeCount }, 'burst handled');
  } catch (err) {
    logger.error({ contactId, error: err instanceof Error ? err.message : String(err) }, 'handleBurst failed');
  }
});

const manualOverride = createManualOverride({ unblock: (jid) => unblock(currentSocket(), jid) });
const contactDirectory = createContactDirectory();
// A getter, not the socket itself — like currentSocket(), it must follow
// reconnects, and a lookup while disconnected fails open instead of throwing.
const profilePhotos = createProfilePhotos({ getSocket: () => sock });
const monitoredContacts = {
  list: listMonitored,
  isMonitored,
  get: getMonitored,
  add: addMonitored,
  remove: removeMonitored,
  setEscalationEnabled,
  setContext,
  setCallNuisanceThreshold,
  setBlockBackoffMax,
};
const callActions = {
  rejectCall: (callId: string, callFrom: string) => rejectCall(currentSocket(), callId, callFrom),
  sendWarning: (jid: string, text: string) => sendWarning(currentSocket(), jid, text),
  block: (jid: string) => block(currentSocket(), jid),
};

let unblockScheduler: ReturnType<typeof startUnblockScheduler> | undefined;
let controlServer: ReturnType<typeof createControlServer> | undefined;

async function start() {
  // Order matters: the SHADOW_MODE carry-over must run before
  // ensureDefaultsSeeded() seeds that same key's hardcoded default — see
  // migrateShadowModeFromEnv's doc comment.
  migrateShadowModeFromEnv();
  // Must run before anything else touches a moderation-tuning setting, so
  // every read downstream sees a real value instead of racing an empty table.
  ensureDefaultsSeeded();
  normalizeLegacyBoolSettings();

  controlServer = createControlServer({
    manualOverride,
    contactDirectory,
    profilePhotos,
    monitoredContacts,
    auditLog: { getPage: getAuditLogPage, getStats: getAuditLogStats },
    blocks: { countActive: countActiveBlocks },
    allowedLogin: ALLOWED_TAILSCALE_LOGIN,
    getSelfId: selfContactId,
    getConnectionState,
    allowSelf: ALLOW_SELF,
  });
  await controlServer.listen(CONTROL_PORT);

  await connectWhatsApp({
    authDir: AUTH_DIR,
    qrPngPath: QR_PNG_PATH,
    onSocket: (s: WASocket) => {
      sock = s;
      contactDirectory.attach(s);
      blocklistSync = attachBlocklistSync(s);
      s.ev.on('messages.upsert', ({ messages, type }) => {
        for (const msg of messages) {
          // Reconciled the same way the directory is (@lid vs. phone-number
          // JID) — otherwise a contact added to the roster under one form
          // never matches a message addressed by the other, and gets
          // silently dropped here before classification ever runs.
          const contactId = canonicalMessageContactId(msg.key);
          if (!contactId || !isMonitored(contactId) || manualOverride.isPaused(contactId)) continue;

          const incoming = extractIncomingMessage(msg, ALLOW_SELF, type);
          if (incoming) {
            buffer.push(contactId, incoming);
            continue;
          }

          const outgoing = extractOutgoingMessage(msg, type);
          if (outgoing) recordOutgoingMessage(contactId, outgoing);
        }
      });
      // An edit is a fresh message as far as moderation goes: a benign message can be edited into a harmful one after it already passed.
      s.ev.on('messages.update', (updates) => {
        for (const update of updates) {
          const edited = extractEditedMessage(update, ALLOW_SELF);
          if (!edited) continue;

          const contactId = canonicalMessageContactId(update.key);
          if (!contactId || !isMonitored(contactId) || manualOverride.isPaused(contactId)) continue;

          logger.info({ contactId }, 'message edited; queued for reclassification');
          buffer.push(contactId, edited);
        }
      });
      s.ev.on('call', (calls) => {
        // Group calls aren't something this app's 1:1 roster/strike model covers — skipped rather than mis-attributed to a group JID.
        for (const call of calls) {
          if (call.isGroup) continue;
          const contactId = canonicalContactId({ id: call.chatId, phoneNumber: call.callerPn });
          if (!contactId || !isMonitored(contactId) || manualOverride.isPaused(contactId)) continue;

          handleCallEvent({ contactId, call }, callActions).catch((err) =>
            logger.error({ contactId, error: err instanceof Error ? err.message : String(err) }, 'handleCallEvent failed'),
          );
        }
      });
    },
    onOpen: () => {
      setConnectionState('open');
      logger.info({ monitored: listMonitored().length, allowSelf: ALLOW_SELF }, 'connected; moderating monitored contacts');
      printSuccessBanner([
        'Connected — moderation is live for the monitored roster.',
        `Open ${getControlAppUrl(CONTROL_PORT, ALLOWED_TAILSCALE_LOGIN)} to add a contact.`,
        'This terminal is now just showing live logs — press Ctrl+C anytime, the app keeps running in the background.',
      ]);
      // Only start once — its unblock(jid) closure always reads the current outer `sock`, so it survives reconnects on its own.
      unblockScheduler ??= startUnblockScheduler({ unblock: (jid) => unblock(currentSocket(), jid) });
      blocklistSync?.reconcile().catch((err: unknown) => logger.error({ error: err instanceof Error ? err.message : String(err) }, 'blocklist reconcile failed'));
    },
    onReconnectFailed: () => setConnectionState('offline'),
    onClose: ({ statusCode, shouldReconnect }: { statusCode: number | undefined; shouldReconnect: boolean }) => {
      setConnectionState(shouldReconnect ? 'reconnecting' : 'logged-out', statusCode ?? null);
      logger.warn({ statusCode, shouldReconnect }, 'connection closed');
    },
  });
}

async function shutdown(signal: NodeJS.Signals): Promise<void> {
  logger.info({ signal }, 'shutting down');
  await controlServer?.close();
  await unblockScheduler?.stop();
  await buffer.flushAll();
  await Promise.allSettled([...pendingBursts(), ...pendingCallEvents()]);
  closeDb();
  process.exit(0);
}

process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));

start().catch((err: unknown) => {
  logger.error({ error: err instanceof Error ? err.message : String(err) }, 'fatal error starting connection');
  process.exit(1);
});
