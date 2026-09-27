import pino from 'pino';
import { connectWhatsApp } from './src/whatsapp/connection.ts';
import { createMessageBuffer } from './src/buffer/message-buffer.ts';
import { handleBurst, pendingBursts } from './src/pipeline/moderation-pipeline.ts';
import { startUnblockScheduler } from './src/pipeline/unblock-scheduler.ts';
import { extractIncomingMessage } from './src/pipeline/incoming-message.ts';
import { createManualOverride } from './src/override/manual-override.ts';
import { createContactDirectory, canonicalContactId, canonicalMessageContactId } from './src/whatsapp/contact-directory.ts';
import { createControlServer } from './src/web/control-server.ts';
import { closeDb } from './src/store/db.ts';
import {
  listMonitored,
  isMonitored,
  getMonitored,
  addMonitored,
  removeMonitored,
  setEscalationEnabled,
} from './src/store/monitored-contacts.ts';
import { getAuditLogPage, getAuditLogStats } from './src/store/audit-log.ts';
import { countActiveBlocks } from './src/store/blocks.ts';
import { deleteForMe, sendWarning, block, unblock } from './src/whatsapp/actions.ts';
import type { WASocket } from '@whiskeysockets/baileys';
import type { IncomingMessage } from './src/types.ts';

const AUTH_DIR = './auth_info';
const QR_PNG_PATH = './auth_info/login-qr.png';
// No second number handy? Set TEST_ALLOW_SELF=1 — see README "Testing each layer in isolation".
const ALLOW_SELF = process.env.TEST_ALLOW_SELF === '1';
// See README "Web control app" before enabling this.
const RAW_WEB_CONTROL_PORT = process.env.WEB_CONTROL_PORT;
const WEB_CONTROL_PORT = RAW_WEB_CONTROL_PORT ? Number(RAW_WEB_CONTROL_PORT) : undefined;
const ALLOWED_TAILSCALE_LOGIN = process.env.ALLOWED_TAILSCALE_LOGIN;

// Checked against the raw string, not WEB_CONTROL_PORT itself, since "0"/NaN are falsy and would otherwise skip these checks silently.
if (RAW_WEB_CONTROL_PORT) {
  if (WEB_CONTROL_PORT === undefined || !Number.isInteger(WEB_CONTROL_PORT) || WEB_CONTROL_PORT <= 0) {
    console.error(`WEB_CONTROL_PORT must be a positive integer, got: ${RAW_WEB_CONTROL_PORT}`);
    process.exit(1);
  }
  if (!ALLOWED_TAILSCALE_LOGIN) {
    console.error('WEB_CONTROL_PORT is set but ALLOWED_TAILSCALE_LOGIN is not — refusing to start the control server unauthenticated.');
    process.exit(1);
  }
}

const logger = pino({ name: 'index' });

let sock: WASocket | undefined;

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
      },
    );
    logger.info({ contactId, strikeCount }, 'burst handled');
  } catch (err) {
    logger.error({ contactId, error: err instanceof Error ? err.message : String(err) }, 'handleBurst failed');
  }
});

const manualOverride = createManualOverride({ unblock: (jid) => unblock(currentSocket(), jid) });
const contactDirectory = createContactDirectory();
const monitoredContacts = {
  list: listMonitored,
  isMonitored,
  get: getMonitored,
  add: addMonitored,
  remove: removeMonitored,
  setEscalationEnabled,
};

let unblockScheduler: ReturnType<typeof startUnblockScheduler> | undefined;
let controlServer: ReturnType<typeof createControlServer> | undefined;

async function start() {
  if (WEB_CONTROL_PORT) {
    controlServer = createControlServer({
      manualOverride,
      contactDirectory,
      monitoredContacts,
      auditLog: { getPage: getAuditLogPage, getStats: getAuditLogStats },
      blocks: { countActive: countActiveBlocks },
      allowedLogin: ALLOWED_TAILSCALE_LOGIN!,
      getSelfId: selfContactId,
      allowSelf: ALLOW_SELF,
    });
    await controlServer.listen(WEB_CONTROL_PORT);
  }

  await connectWhatsApp({
    authDir: AUTH_DIR,
    qrPngPath: QR_PNG_PATH,
    onSocket: (s: WASocket) => {
      sock = s;
      contactDirectory.attach(s);
      s.ev.on('messages.upsert', ({ messages, type }) => {
        for (const msg of messages) {
          // Reconciled the same way the directory is (@lid vs. phone-number
          // JID) — otherwise a contact added to the roster under one form
          // never matches a message addressed by the other, and gets
          // silently dropped here before classification ever runs.
          const contactId = canonicalMessageContactId(msg.key);
          if (!contactId || !isMonitored(contactId) || manualOverride.isPaused(contactId)) continue;

          const incoming = extractIncomingMessage(msg, ALLOW_SELF, type);
          if (incoming) buffer.push(contactId, incoming);
        }
      });
    },
    onOpen: () => {
      logger.info({ monitored: listMonitored().length, allowSelf: ALLOW_SELF }, 'connected; moderating monitored contacts');
      // Only start once — its unblock(jid) closure always reads the current outer `sock`, so it survives reconnects on its own.
      unblockScheduler ??= startUnblockScheduler({ unblock: (jid) => unblock(currentSocket(), jid) });
    },
    onClose: ({ statusCode, shouldReconnect }: { statusCode: number | undefined; shouldReconnect: boolean }) => logger.warn({ statusCode, shouldReconnect }, 'connection closed'),
  });
}

async function shutdown(signal: NodeJS.Signals): Promise<void> {
  logger.info({ signal }, 'shutting down');
  await controlServer?.close();
  await unblockScheduler?.stop();
  await buffer.flushAll();
  await Promise.allSettled(pendingBursts());
  closeDb();
  process.exit(0);
}

process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));

start().catch((err: unknown) => {
  logger.error({ error: err instanceof Error ? err.message : String(err) }, 'fatal error starting connection');
  process.exit(1);
});
