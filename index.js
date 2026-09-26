import pino from 'pino';
import { jidNormalizedUser } from '@whiskeysockets/baileys';
import { connectWhatsApp } from './src/whatsapp/connection.js';
import { createMessageBuffer } from './src/buffer/message-buffer.js';
import { handleBurst, pendingBursts } from './src/pipeline/moderation-pipeline.js';
import { startUnblockScheduler } from './src/pipeline/unblock-scheduler.js';
import { extractIncomingMessage } from './src/pipeline/incoming-message.js';
import { createOverrideChannel, extractOverrideMessage, parseOverrideCommand } from './src/override/override-channel.js';
import { closeDb } from './src/store/db.js';
import { deleteForMe, sendMessage, sendWarning, block, unblock } from './src/whatsapp/actions.js';

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

const overrideChannel = createOverrideChannel({
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
        // sock.user is only populated once auth completes, so a message
        // arriving before then can't be an override — extractOverrideMessage
        // handles that via its own falsy selfJid guard.
        const selfJid = sock.user?.id && jidNormalizedUser(sock.user.id);

        for (const msg of messages) {
          const overrideText = extractOverrideMessage(msg, selfJid, type);
          const command = overrideText && parseOverrideCommand(overrideText);
          if (command) {
            overrideChannel
              .runCommand(command)
              .then((reply) => reply && sendMessage(sock, selfJid, reply))
              .catch((err) => logger.error({ command, error: err?.message ?? String(err) }, 'override command failed'));
            continue;
          }

          if (overrideChannel.isPaused()) continue;

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
