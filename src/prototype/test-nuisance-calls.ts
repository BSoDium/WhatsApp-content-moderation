// Throwaway validation script — see README "Validating nuisance-call handling" (npm run prototype:nuisance-calls). Logs every 'call' event Baileys emits and, with REJECT=1 set, rejects each offer as it arrives — run this against a real second number before trusting the full pipeline built on top of it.

import { connectWhatsApp } from '../whatsapp/connection.ts';

const AUTH_DIR = './auth_info';
const QR_PNG_PATH = './auth_info/login-qr.png';
const REJECT_OFFERS = process.env.REJECT === '1';

async function start() {
  await connectWhatsApp({
    authDir: AUTH_DIR,
    qrPngPath: QR_PNG_PATH,
    onSocket: (sock) => {
      sock.ev.on('call', (calls) => {
        for (const call of calls) {
          console.log(
            `[call] status=${call.status} id=${call.id} from=${call.from} chatId=${call.chatId} isVideo=${call.isVideo} isGroup=${call.isGroup} offline=${call.offline}`,
          );

          if (call.status === 'offer' && REJECT_OFFERS) {
            console.log(`Rejecting call ${call.id} from ${call.from}...`);
            sock
              .rejectCall(call.id, call.from)
              .then(() => console.log(`[rejectCall] succeeded for ${call.id}`))
              .catch((err) => console.error(`[rejectCall] failed for ${call.id}:`, err?.message ?? err));
          }
        }
      });
    },
    onOpen: () => {
      console.log('\nConnected. Waiting for calls...');
      console.log(REJECT_OFFERS ? 'REJECT=1 set: every offer will be auto-rejected.' : 'Set REJECT=1 to also test sock.rejectCall() on each offer.');
      console.log('>>> Call this account from a second number now. <<<\n');
    },
    onClose: ({ statusCode, shouldReconnect }) => console.log('Connection closed.', { statusCode, shouldReconnect }),
  });
}

start().catch((err) => {
  console.error('Fatal error:', err);
  process.exit(1);
});
