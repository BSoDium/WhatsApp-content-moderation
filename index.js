import pino from 'pino';
import { connectWhatsApp } from './src/whatsapp/connection.js';
import { createMessageBuffer } from './src/buffer/message-buffer.js';
import { handleBurst, pendingBursts } from './src/pipeline/moderation-pipeline.js';
import { startUnblockScheduler } from './src/pipeline/unblock-scheduler.js';
import { extractIncomingMessage } from './src/pipeline/incoming-message.js';
import { createManualOverride } from './src/override/manual-override.js';
import { closeDb } from './src/store/db.js';
import { deleteForMe, sendWarning, block, unblock } from './src/whatsapp/actions.js';

const AUTH_DIR = './auth_info';
const QR_PNG_PATH = './auth_info/login-qr.png';
const TARGET_CONTACT_JID = process.env.TARGET_CONTACT_JID;
// No second number handy? Set TEST_ALLOW_SELF=1 — see README "Testing each layer in isolation".
const ALLOW_SELF = process.env.TEST_ALLOW_SELF === '1';

if (!TARGET_CONTACT_JID) {
  console.error(
    'Set TARGET_CONTACT_JID to the WhatsApp JID of the contact to moderate (e.g. 15551234567@s.whatsapp.net).',
  );
  process.exit(1);
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

// Not yet driven by anything — see docs/decisions.md "Manual override
// channel (issue #9)". Wired here so isPaused() already gates the pipeline
// once a control surface (planned: a VPN-accessible web app) exists to call
// runCommand().
const manualOverride = createManualOverride({
  targetContactId: TARGET_CONTACT_JID,
  unblock: (jid) => unblock(sock, jid),
});

let unblockScheduler;

async function start() {
  await connectWhatsApp({
    authDir: AUTH_DIR,
    qrPngPath: QR_PNG_PATH,
    onSocket: (s) => {
      sock = s;
      s.ev.on('messages.upsert', ({ messages, type }) => {
        if (manualOverride.isPaused()) return;

        for (const msg of messages) {
          const incoming = extractIncomingMessage(msg, TARGET_CONTACT_JID, ALLOW_SELF, type);
          if (incoming) buffer.push(TARGET_CONTACT_JID, incoming);
        }
      });
    },
    onOpen: () => {
      logger.info({ target: TARGET_CONTACT_JID, allowSelf: ALLOW_SELF }, 'connected; moderating target contact');
      // Only start once — its unblock(jid) closure always reads the current outer `sock`, so it survives reconnects on its own.
      unblockScheduler ??= startUnblockScheduler({ unblock: (jid) => unblock(sock, jid) });
    },
    onClose: ({ statusCode, shouldReconnect }) => logger.warn({ statusCode, shouldReconnect }, 'connection closed'),
  });
}

async function shutdown(signal) {
  logger.info({ signal }, 'shutting down');
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
