// Throwaway validation script — see README "Validating 'delete for me'" (npm run prototype:delete-for-me, or TEST_ALLOW_SELF=1 with no second number handy).

import { connectWhatsApp } from '../whatsapp/connection.js';

const AUTH_DIR = './auth_info';
const DELETE_DELAY_MS = 3000;
const QR_PNG_PATH = './auth_info/login-qr.png';
const ALLOW_SELF = process.env.TEST_ALLOW_SELF === '1';

async function start() {
  await connectWhatsApp({
    authDir: AUTH_DIR,
    qrPngPath: QR_PNG_PATH,
    onSocket: (sock) => {
      sock.ev.on('messages.upsert', async ({ messages, type }) => {
        if (type !== 'notify') return;

        for (const msg of messages) {
          if (!msg.message) continue;
          if (msg.key.fromMe && !ALLOW_SELF) continue;

          const from = msg.key.remoteJid;
          const text =
            msg.message.conversation ?? msg.message.extendedTextMessage?.text ?? '(non-text message)';

          console.log(`[received] from=${from} text=${JSON.stringify(text)}`);
          console.log(`Deleting for me in ${DELETE_DELAY_MS}ms...`);

          setTimeout(async () => {
            try {
              await sock.chatModify(
                {
                  deleteForMe: {
                    deleteMedia: false,
                    key: msg.key,
                    timestamp: Number(msg.messageTimestamp) * 1000,
                  },
                },
                from,
              );
              console.log(`[deleteForMe] app-state patch sent for key=${msg.key.id}`);
              console.log('>>> Now check your phone: did the message vanish? <<<');
            } catch (err) {
              console.error('[deleteForMe] failed:', err);
            }
          }, DELETE_DELAY_MS);
        }
      });
    },
    onOpen: () => {
      console.log('\nConnected. Waiting for a message from a test contact...\n');
      if (ALLOW_SELF) {
        console.log('TEST_ALLOW_SELF=1: also watching for messages you send yourself.\n');
      } else {
        console.log('Send this account any text message from another number, then watch your phone.\n');
      }
    },
    onClose: ({ statusCode, shouldReconnect }) => console.log('Connection closed.', { statusCode, shouldReconnect }),
  });
}

start().catch((err) => {
  console.error('Fatal error:', err);
  process.exit(1);
});
