// Isolated smoke test for src/whatsapp/actions.js. No second number needed
// and don't run this alongside `npm start` — they'd fight over one session:
//
//   TARGET_CONTACT_JID=<own JID, or any JID you can message> npm run whatsapp:test-actions

import { makeWASocket, useMultiFileAuthState, DisconnectReason } from '@whiskeysockets/baileys';
import { Boom } from '@hapi/boom';
import qrcode from 'qrcode-terminal';
import pino from 'pino';
import { deleteForMe, sendWarning } from './actions.js';

const AUTH_DIR = './auth_info';
const TARGET_JID = process.env.TARGET_CONTACT_JID;

if (!TARGET_JID) {
  console.error('Set TARGET_CONTACT_JID to a JID you can message (e.g. your own).');
  process.exit(1);
}

async function start() {
  const { state, saveCreds } = await useMultiFileAuthState(AUTH_DIR);
  const sock = makeWASocket({ auth: state, logger: pino({ level: 'silent' }), printQRInTerminal: false });
  sock.ev.on('creds.update', saveCreds);

  sock.ev.on('connection.update', async (update) => {
    const { connection, lastDisconnect, qr } = update;

    if (qr) {
      console.log('\nScan this QR code with WhatsApp on your phone (Linked Devices):\n');
      qrcode.generate(qr, { small: true });
    }

    if (connection === 'close') {
      const statusCode = new Boom(lastDisconnect?.error)?.output?.statusCode;
      const shouldReconnect = statusCode !== DisconnectReason.loggedOut;
      console.log('[connection] closed', { statusCode, shouldReconnect });
      if (shouldReconnect) start().catch((err) => console.error('Reconnect failed:', err?.message ?? err));
      return;
    }

    if (connection !== 'open') return;

    console.log(`[connection] open — testing sendWarning + deleteForMe against ${TARGET_JID}\n`);

    let sent;
    try {
      sent = await sendWarning(sock, TARGET_JID, '[whatsapp:test-actions] sendWarning check');
      console.log('[PASS] sendWarning');
    } catch (err) {
      console.error('[FAIL] sendWarning:', err?.message ?? err);
      process.exit(1);
    }

    try {
      await deleteForMe(sock, TARGET_JID, sent.key, Number(sent.messageTimestamp) * 1000);
      console.log('[PASS] deleteForMe');
    } catch (err) {
      console.error('[FAIL] deleteForMe:', err?.message ?? err);
      process.exit(1);
    }

    console.log('\nBoth primitives responded without error. Check your phone to confirm the message arrived and then vanished.');
    process.exit(0);
  });
}

start().catch((err) => {
  console.error('Fatal:', err?.message ?? err);
  process.exit(1);
});
