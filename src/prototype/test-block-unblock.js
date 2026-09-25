// Throwaway validation script — confirms whether Baileys can actually block
// and unblock a contact (not just delete messages), before issue #8 builds a
// jittered scheduler on top of that assumption the way deleteForMe's
// prototype validated its own assumption first (see issue #16).
//
// Needs a real second WhatsApp number as BLOCK_TEST_JID — you can't block
// your own "Message yourself" chat, so there's no self-test fallback here
// the way test-delete-for-me.js has TEST_ALLOW_SELF. Run on the machine you
// intend to self-host on (needs an interactive terminal to scan the QR code
// with your phone, unless auth_info/ is already linked from
// test-delete-for-me.js):
//
//   BLOCK_TEST_JID=15551234567@s.whatsapp.net npm run prototype:block-unblock
//
// Watch the console for fetchBlocklist() confirmation after each step, AND
// check the test number's chat on your phone directly: does it show as
// blocked, then unblocked?

import { makeWASocket, useMultiFileAuthState, DisconnectReason } from '@whiskeysockets/baileys';
import { Boom } from '@hapi/boom';
import qrcode from 'qrcode-terminal';
import QRCode from 'qrcode';
import pino from 'pino';

const AUTH_DIR = './auth_info';
const UNBLOCK_DELAY_MS = 5000;
const QR_PNG_PATH = './auth_info/login-qr.png';
const TARGET_JID = process.env.BLOCK_TEST_JID;

if (!TARGET_JID) {
  console.error(
    'Set BLOCK_TEST_JID to a real contact\'s JID (e.g. 15551234567@s.whatsapp.net) before running this.',
  );
  process.exit(1);
}

async function start() {
  const { state, saveCreds } = await useMultiFileAuthState(AUTH_DIR);

  const sock = makeWASocket({
    auth: state,
    logger: pino({ level: 'silent' }),
    printQRInTerminal: false,
  });

  sock.ev.on('creds.update', saveCreds);

  sock.ev.on('blocklist.update', ({ blocklist, type }) => {
    console.log(`[blocklist.update] type=${type} blocklist=${JSON.stringify(blocklist)}`);
  });

  sock.ev.on('connection.update', (update) => {
    const { connection, lastDisconnect, qr } = update;

    if (qr) {
      console.log('\nScan this QR code with WhatsApp on your phone (Linked Devices):\n');
      qrcode.generate(qr, { small: true });
      QRCode.toFile(QR_PNG_PATH, qr, { width: 400 })
        .then(() => console.log(`[qr] also saved to ${QR_PNG_PATH}`))
        .catch((err) => console.error('[qr] failed to save PNG:', err));
    }

    if (connection === 'close') {
      const statusCode = new Boom(lastDisconnect?.error)?.output?.statusCode;
      const shouldReconnect = statusCode !== DisconnectReason.loggedOut;
      console.log('Connection closed.', { statusCode, shouldReconnect });
      if (shouldReconnect) start();
    } else if (connection === 'open') {
      console.log(`\nConnected. Testing block/unblock against ${TARGET_JID}...\n`);
      runTest(sock).catch((err) => {
        console.error('Fatal error during block/unblock test:', err);
        process.exit(1);
      });
    }
  });
}

async function runTest(sock) {
  const before = await sock.fetchBlocklist();
  console.log(
    `Blocklist before: ${before.length} entries, target ${before.includes(TARGET_JID) ? 'already present' : 'not present'}`,
  );

  console.log(`\nBlocking ${TARGET_JID}...`);
  await sock.updateBlockStatus(TARGET_JID, 'block');
  const afterBlock = await sock.fetchBlocklist();
  console.log(
    `Blocklist after block: target ${afterBlock.includes(TARGET_JID) ? 'IS present (blocked)' : 'MISSING — block did not register'}`,
  );
  console.log('>>> Now check your phone: does this contact show as blocked? <<<');

  console.log(`\nWaiting ${UNBLOCK_DELAY_MS}ms before unblocking...`);
  await new Promise((resolve) => setTimeout(resolve, UNBLOCK_DELAY_MS));

  console.log(`Unblocking ${TARGET_JID}...`);
  await sock.updateBlockStatus(TARGET_JID, 'unblock');
  const afterUnblock = await sock.fetchBlocklist();
  console.log(
    `Blocklist after unblock: target ${afterUnblock.includes(TARGET_JID) ? 'still present — unblock did not register' : 'removed (unblocked)'}`,
  );
  console.log('>>> Check your phone again: is the contact unblocked? Can they message you again? <<<');
}

start().catch((err) => {
  console.error('Fatal error:', err);
  process.exit(1);
});
