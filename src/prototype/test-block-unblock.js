// Throwaway validation script — confirms whether Baileys can actually block
// and unblock a contact. Needs a real second WhatsApp number as
// BLOCK_TEST_JID (see README "Validating block/unblock" for the full setup):
//
//   BLOCK_TEST_JID=15551234567@s.whatsapp.net npm run prototype:block-unblock

import { makeWASocket, useMultiFileAuthState, DisconnectReason } from '@whiskeysockets/baileys';
import { Boom } from '@hapi/boom';
import qrcode from 'qrcode-terminal';
import QRCode from 'qrcode';
import pino from 'pino';

const AUTH_DIR = './auth_info';
const UNBLOCK_DELAY_MS = 5000;
// fetchBlocklist() can lag a live block/unblock call by a few seconds (see
// README) — a single immediate read isn't a reliable pass/fail signal.
const CONFIRM_RETRIES = 4;
const CONFIRM_DELAY_MS = 2000;
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

// Some contacts are reachable under more than one JID form (phone-number
// JID vs the newer @lid form) — comparing fetchBlocklist() against only the
// literal BLOCK_TEST_JID string can miss a real match. Resolves every form
// WhatsApp itself associates with this number.
async function resolveJids(sock) {
  const jids = new Set([TARGET_JID]);
  try {
    const [result] = (await sock.onWhatsApp(TARGET_JID)) ?? [];
    if (result?.jid) jids.add(result.jid);
    if (result?.lid) jids.add(result.lid);
  } catch (err) {
    console.error('[onWhatsApp] lookup failed, falling back to the literal JID only:', err?.message ?? err);
  }
  return [...jids];
}

// A single immediate fetchBlocklist() read can catch WhatsApp mid-propagation
// and report a false negative — retries a few times before giving up.
async function confirmBlocklistState(sock, jids, expectPresent) {
  for (let attempt = 1; attempt <= CONFIRM_RETRIES; attempt++) {
    const blocklist = await sock.fetchBlocklist();
    const present = blocklist.some((entry) => jids.includes(entry));
    if (present === expectPresent) return { confirmed: true, attempt };
    if (attempt < CONFIRM_RETRIES) await new Promise((resolve) => setTimeout(resolve, CONFIRM_DELAY_MS));
  }
  return { confirmed: false, attempt: CONFIRM_RETRIES };
}

async function runTest(sock) {
  const jids = await resolveJids(sock);
  console.log(`Resolved JID forms for ${TARGET_JID}: ${jids.join(', ')}`);

  const before = await sock.fetchBlocklist();
  console.log(
    `Blocklist before: ${before.length} entries, target ${before.some((entry) => jids.includes(entry)) ? 'already present' : 'not present'}`,
  );

  console.log(`\nBlocking ${TARGET_JID}...`);
  await sock.updateBlockStatus(TARGET_JID, 'block');
  const blocked = await confirmBlocklistState(sock, jids, true);
  console.log(
    blocked.confirmed
      ? `Blocklist after block: target IS present (blocked), confirmed on attempt ${blocked.attempt}`
      : `Blocklist after block: target still MISSING after ${CONFIRM_RETRIES} checks — check your phone before assuming this failed`,
  );
  console.log('>>> Now check your phone: does this contact show as blocked? <<<');

  console.log(`\nWaiting ${UNBLOCK_DELAY_MS}ms before unblocking...`);
  await new Promise((resolve) => setTimeout(resolve, UNBLOCK_DELAY_MS));

  console.log(`Unblocking ${TARGET_JID}...`);
  await sock.updateBlockStatus(TARGET_JID, 'unblock');
  const unblocked = await confirmBlocklistState(sock, jids, false);
  console.log(
    unblocked.confirmed
      ? `Blocklist after unblock: target removed (unblocked), confirmed on attempt ${unblocked.attempt}`
      : `Blocklist after unblock: target still present after ${CONFIRM_RETRIES} checks — check your phone before assuming this failed`,
  );
  console.log('>>> Check your phone again: is the contact unblocked? Can they message you again? <<<');

  process.exit(0);
}

start().catch((err) => {
  console.error('Fatal error:', err);
  process.exit(1);
});
