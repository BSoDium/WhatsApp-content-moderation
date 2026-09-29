import type { proto, WAMessage } from '@whiskeysockets/baileys';

export function extractMessageText(message: proto.IMessage | null | undefined): string | undefined {
  return message?.conversation ?? message?.extendedTextMessage?.text ?? undefined;
}

export function extractMessageTimestamp(messageTimestamp: WAMessage['messageTimestamp']): number {
  // Baileys types messageTimestamp as optional; falling back to "now" rather
  // than letting a missing value through as NaN, which would otherwise flow
  // into deleteForMe's sock.chatModify call and likely make it throw.
  const rawTimestamp = messageTimestamp == null ? NaN : Number(messageTimestamp);
  return Number.isFinite(rawTimestamp) ? rawTimestamp * 1000 : Date.now();
}
