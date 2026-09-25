import { makeWASocket, useMultiFileAuthState, DisconnectReason } from '@whiskeysockets/baileys';
import { Boom } from '@hapi/boom';
import qrcode from 'qrcode-terminal';
import QRCode from 'qrcode';
import pino from 'pino';
import { createMessageBuffer } from './src/buffer/message-buffer.js';
import { handleBurst, pendingBursts } from './src/pipeline/moderation-pipeline.js';
import { startUnblockScheduler } from './src/pipeline/unblock-scheduler.js';
import { extractIncomingMessage } from './src/pipeline/incoming-message.js';
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

let unblockScheduler;

async function start() {
  const { state, saveCreds } = await useMultiFileAuthState(AUTH_DIR);

  sock = makeWASocket({
    auth: state,
    logger: pino({ level: 'silent' }),
    printQRInTerminal: false,
  });

  sock.ev.on('creds.update', saveCreds);

  sock.ev.on('connection.update', (update) => {
    const { connection, lastDisconnect, qr } = update;

    if (qr) {
      console.log('\nScan this QR code with WhatsApp on your phone (Linked Devices):\n');
      qrcode.generate(qr, { small: true });
      QRCode.toFile(QR_PNG_PATH, qr, { width: 400 })
        .then(() => logger.info(`[qr] also saved to ${QR_PNG_PATH}`))
        .catch((err) => logger.error({ error: err?.message ?? String(err) }, '[qr] failed to save PNG'));
    }

    if (connection === 'close') {
      const statusCode = new Boom(lastDisconnect?.error)?.output?.statusCode;
      const shouldReconnect = statusCode !== DisconnectReason.loggedOut;
      logger.warn({ statusCode, shouldReconnect }, 'connection closed');
      if (shouldReconnect) {
        start().catch((err) => logger.error({ error: err?.message ?? String(err) }, 'reconnect failed'));
      }
    } else if (connection === 'open') {
      logger.info({ target: TARGET_CONTACT_JID, allowSelf: ALLOW_SELF }, 'connected; moderating target contact');
      // Only start once — 'open' fires again after every reconnect, but the
      // scheduler's own unblock(sock, jid) closure always reads the current
      // sock, so it doesn't need restarting alongside it.
      unblockScheduler ??= startUnblockScheduler({ unblock: (jid) => unblock(sock, jid) });
    }
  });

  sock.ev.on('messages.upsert', ({ messages, type }) => {
    for (const msg of messages) {
      const incoming = extractIncomingMessage(msg, TARGET_CONTACT_JID, ALLOW_SELF, type);
      if (incoming) buffer.push(TARGET_CONTACT_JID, incoming);
    }
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
