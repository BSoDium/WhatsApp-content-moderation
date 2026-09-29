import type { WAMessage } from '@whiskeysockets/baileys';

export function extractMessageText(msg: WAMessage): string | undefined {
  return msg.message?.conversation ?? msg.message?.extendedTextMessage?.text ?? undefined;
}

export function extractMessageTimestamp(msg: WAMessage): number {
  // Baileys types messageTimestamp as optional; falling back to "now" rather
  // than letting a missing value through as NaN, which would otherwise flow
  // into deleteForMe's sock.chatModify call and likely make it throw.
  const rawTimestamp = Number(msg.messageTimestamp);
  return Number.isFinite(rawTimestamp) ? rawTimestamp * 1000 : Date.now();
}
