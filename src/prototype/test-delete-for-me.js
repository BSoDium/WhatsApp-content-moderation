// Throwaway validation script — confirms whether Baileys' "delete for me"
// app-state sync action actually removes an incoming message from the
// linked phone, before any of the moderation logic gets built on top of it.
//
// Run on the machine you intend to self-host on (needs an interactive
// terminal to scan the QR code with your phone):
//
//   npm install
//   npm run prototype:delete-for-me
//
// Then, from a second WhatsApp account, send this account a test message.
// The script will delete it "for me" a few seconds later and log the
// result. Check your phone: did the message disappear?

import { makeWASocket, useMultiFileAuthState, DisconnectReason } from '@whiskeysockets/baileys';
import { Boom } from '@hapi/boom';
import qrcode from 'qrcode-terminal';
import pino from 'pino';

const AUTH_DIR = './auth_info';
const DELETE_DELAY_MS = 3000;

async function start() {
  const { state, saveCreds } = await useMultiFileAuthState(AUTH_DIR);

  const sock = makeWASocket({
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
    }

    if (connection === 'close') {
      const statusCode = new Boom(lastDisconnect?.error)?.output?.statusCode;
      const shouldReconnect = statusCode !== DisconnectReason.loggedOut;
      console.log('Connection closed.', { statusCode, shouldReconnect });
      if (shouldReconnect) start();
    } else if (connection === 'open') {
      console.log('\nConnected. Waiting for a message from a test contact...\n');
      console.log('Send this account any text message from another number, then watch your phone.\n');
    }
  });

  sock.ev.on('messages.upsert', async ({ messages, type }) => {
    if (type !== 'notify') return;

    for (const msg of messages) {
      if (!msg.message || msg.key.fromMe) continue;

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
}

start().catch((err) => {
  console.error('Fatal error:', err);
  process.exit(1);
});
