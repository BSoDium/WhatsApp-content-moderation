import { makeWASocket, useMultiFileAuthState, DisconnectReason } from '@whiskeysockets/baileys';
import { Boom } from '@hapi/boom';
import qrcode from 'qrcode-terminal';
import QRCode from 'qrcode';
import pino from 'pino';

/**
 * Opens a Baileys socket against `authDir`'s linked-device session and
 * transparently re-opens it on an unexpected close (never on a logout).
 * Shared by every entrypoint that talks to WhatsApp directly, so
 * auth-state loading, credential persistence, QR display/save, and the
 * reconnect-unless-logged-out decision live in one place instead of four.
 *
 * `onSocket` fires synchronously right after the socket is created —
 * before any `connection.update` event — so callers can bind listeners
 * (e.g. `messages.upsert`) before WhatsApp starts delivering/replaying
 * events, the same way each caller already did inline.
 *
 * @param {{
 *   authDir?: string,
 *   qrPngPath?: string,
 *   onSocket?: (sock: object) => void,
 *   onOpen?: (sock: object) => void,
 *   onClose?: (info: { statusCode: number|undefined, shouldReconnect: boolean }) => void,
 * }} [options]
 * @returns {Promise<object>} the Baileys socket
 */
export async function connectWhatsApp({ authDir = './auth_info', qrPngPath, onSocket, onOpen, onClose } = {}) {
  const { state, saveCreds } = await useMultiFileAuthState(authDir);

  const sock = makeWASocket({ auth: state, logger: pino({ level: 'silent' }), printQRInTerminal: false });

  sock.ev.on('creds.update', saveCreds);
  onSocket?.(sock);

  sock.ev.on('connection.update', (update) => {
    const { connection, lastDisconnect, qr } = update;

    if (qr) {
      console.log('\nScan this QR code with WhatsApp on your phone (Linked Devices):\n');
      qrcode.generate(qr, { small: true });
      if (qrPngPath) {
        QRCode.toFile(qrPngPath, qr, { width: 400 })
          .then(() => console.log(`[qr] also saved to ${qrPngPath}`))
          .catch((err) => console.error('[qr] failed to save PNG:', err?.message ?? err));
      }
    }

    if (connection === 'close') {
      const statusCode = new Boom(lastDisconnect?.error)?.output?.statusCode;
      const shouldReconnect = statusCode !== DisconnectReason.loggedOut;
      onClose?.({ statusCode, shouldReconnect });
      if (shouldReconnect) {
        connectWhatsApp({ authDir, qrPngPath, onSocket, onOpen, onClose }).catch((err) =>
          console.error('Reconnect failed:', err?.message ?? err),
        );
      }
    } else if (connection === 'open') {
      onOpen?.(sock);
    }
  });

  return sock;
}
