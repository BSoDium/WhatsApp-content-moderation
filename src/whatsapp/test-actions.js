// Isolated smoke test for src/whatsapp/actions.js — see README "Testing
// each layer in isolation". Don't run alongside `npm start`, they'd fight
// over one session.

import { connectWhatsApp } from './connection.js';
import { deleteForMe, sendWarning } from './actions.js';

const AUTH_DIR = './auth_info';
const TARGET_JID = process.env.TARGET_CONTACT_JID;

if (!TARGET_JID) {
  console.error('Set TARGET_CONTACT_JID to a JID you can message (e.g. your own).');
  process.exit(1);
}

connectWhatsApp({
  authDir: AUTH_DIR,
  onOpen: async (sock) => {
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
  },
  onClose: ({ statusCode, shouldReconnect }) => console.log('[connection] closed', { statusCode, shouldReconnect }),
}).catch((err) => {
  console.error('Fatal:', err?.message ?? err);
  process.exit(1);
});
