import pino from 'pino';
import { connectWhatsApp } from './src/whatsapp/connection.js';
import { createMessageBuffer } from './src/buffer/message-buffer.js';
import { handleBurst, pendingBursts } from './src/pipeline/moderation-pipeline.js';
import { startUnblockScheduler } from './src/pipeline/unblock-scheduler.js';
import { extractIncomingMessage } from './src/pipeline/incoming-message.js';
import { createManualOverride } from './src/override/manual-override.js';
import { createContactDirectory } from './src/whatsapp/contact-directory.js';
import { createControlServer } from './src/web/control-server.js';
import { closeDb } from './src/store/db.js';
import {
  listMonitored,
  isMonitored,
  addMonitored,
  removeMonitored,
  setEscalationEnabled,
} from './src/store/monitored-contacts.js';
import { deleteForMe, sendWarning, block, unblock } from './src/whatsapp/actions.js';

const AUTH_DIR = './auth_info';
const QR_PNG_PATH = './auth_info/login-qr.png';
// No second number handy? Set TEST_ALLOW_SELF=1 — see README "Testing each layer in isolation".
const ALLOW_SELF = process.env.TEST_ALLOW_SELF === '1';
// See README "Web control app" before enabling this.
const RAW_WEB_CONTROL_PORT = process.env.WEB_CONTROL_PORT;
const WEB_CONTROL_PORT = RAW_WEB_CONTROL_PORT ? Number(RAW_WEB_CONTROL_PORT) : undefined;
const ALLOWED_TAILSCALE_LOGIN = process.env.ALLOWED_TAILSCALE_LOGIN;
const CONTROL_SERVER_TOKEN = process.env.CONTROL_SERVER_TOKEN;

// Checked against the raw string, not WEB_CONTROL_PORT itself, since "0"/NaN are falsy and would otherwise skip these checks silently.
if (RAW_WEB_CONTROL_PORT) {
  if (!Number.isInteger(WEB_CONTROL_PORT) || WEB_CONTROL_PORT <= 0) {
    console.error(`WEB_CONTROL_PORT must be a positive integer, got: ${RAW_WEB_CONTROL_PORT}`);
    process.exit(1);
  }
  if (!ALLOWED_TAILSCALE_LOGIN || !CONTROL_SERVER_TOKEN) {
    console.error('WEB_CONTROL_PORT is set but ALLOWED_TAILSCALE_LOGIN and/or CONTROL_SERVER_TOKEN is not — refusing to start the control server unauthenticated.');
    process.exit(1);
  }
}

const logger = pino({ name: 'index' });

let sock;

const buffer = createMessageBuffer(async (contactId, messages) => {
  try {
    const { strikeCount } = await handleBurst(
      { contactId, messages },
      {
        deleteForMe: (jid, key, timestamp) => deleteForMe(sock, jid, key, timestamp),
        sendWarning: (jid, text) => sendWarning(sock, jid, text),
        block: (jid) => block(sock, jid),
      },
    );
    logger.info({ contactId, strikeCount }, 'burst handled');
  } catch (err) {
    logger.error({ contactId, error: err?.message ?? String(err) }, 'handleBurst failed');
  }
});

const manualOverride = createManualOverride({ unblock: (jid) => unblock(sock, jid) });
const contactDirectory = createContactDirectory();
const monitoredContacts = { list: listMonitored, isMonitored, add: addMonitored, remove: removeMonitored, setEscalationEnabled };

let unblockScheduler;
let controlServer;

async function start() {
  if (WEB_CONTROL_PORT) {
    controlServer = createControlServer({
      manualOverride,
      contactDirectory,
      monitoredContacts,
      allowedLogin: ALLOWED_TAILSCALE_LOGIN,
      controlToken: CONTROL_SERVER_TOKEN,
    });
    await controlServer.listen(WEB_CONTROL_PORT);
  }

  await connectWhatsApp({
    authDir: AUTH_DIR,
    qrPngPath: QR_PNG_PATH,
    onSocket: (s) => {
      sock = s;
      contactDirectory.attach(s);
      s.ev.on('messages.upsert', ({ messages, type }) => {
        for (const msg of messages) {
          const contactId = msg.key.remoteJid;
          if (!contactId || !isMonitored(contactId) || manualOverride.isPaused(contactId)) continue;

          const incoming = extractIncomingMessage(msg, ALLOW_SELF, type);
          if (incoming) buffer.push(contactId, incoming);
        }
      });
    },
    onOpen: () => {
      logger.info({ monitored: listMonitored().length, allowSelf: ALLOW_SELF }, 'connected; moderating monitored contacts');
      // Only start once — its unblock(jid) closure always reads the current outer `sock`, so it survives reconnects on its own.
      unblockScheduler ??= startUnblockScheduler({ unblock: (jid) => unblock(sock, jid) });
    },
    onClose: ({ statusCode, shouldReconnect }) => logger.warn({ statusCode, shouldReconnect }, 'connection closed'),
  });
}

async function shutdown(signal) {
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

start().catch((err) => {
  logger.error({ error: err?.message ?? String(err) }, 'fatal error starting connection');
  process.exit(1);
});
