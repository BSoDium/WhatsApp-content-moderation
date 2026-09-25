// Isolated smoke test for src/whatsapp/actions.js — validates that
// sendWarning and deleteForMe actually work against a live WhatsApp
// connection, independent of the classifier/buffer/pipeline. No second
// number needed: it sends a throwaway message to TARGET_CONTACT_JID and
// immediately deletes it, so a friend's participation is never required
// just to check whether these two primitives still work.
//
// Reuses whatever session is already linked in auth_info/ (see README
// "Running it" for how to link one). Needs an existing, *settled* link —
// a companion device needs a few minutes after first pairing before
// WhatsApp pushes the app-state sync key deleteForMe depends on; if this
// fails with "App state key not present!" that's almost certainly why.
//
//   TARGET_CONTACT_JID=<own JID, or any JID you can message> npm run whatsapp:test-actions

import { makeWASocket, useMultiFileAuthState, DisconnectReason } from '@whiskeysockets/baileys';
import { Boom } from '@hapi/boom';
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
    const { connection, lastDisconnect } = update;

    if (connection === 'close') {
      const statusCode = new Boom(lastDisconnect?.error)?.output?.statusCode;
      const shouldReconnect = statusCode !== DisconnectReason.loggedOut;
      console.log('[connection] closed', { statusCode, shouldReconnect });
      if (shouldReconnect) start();
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
