import type { WAMessageKey } from '@whiskeysockets/baileys';

export type Classification =
  | { ok: true; flagged: boolean; category: string; reason: string }
  | { ok: false; error: string };

export interface IncomingMessage {
  text: string;
  key: WAMessageKey;
  timestamp: number;
}

export interface BlockRecord {
  id: number;
  contact_id: string;
  blocked_at: number;
  unblock_at: number;
  unblocked_at: number | null;
}

export interface AuditLogRecord {
  id: number;
  contact_id: string;
  direction: 'me' | 'them';
  message: string;
  classification_ok: number;
  flagged: number | null;
  category: string | null;
  reason: string | null;
  error: string | null;
  action: string;
  created_at: number;
}

export interface ContactRecord {
  contact_id: string;
  name: string | null;
  notify: string | null;
  verified_name: string | null;
  lid: string | null;
  last_message_at: number | null;
}

export interface MonitoredContactRecord {
  contact_id: string;
  escalation_enabled: number;
  added_at: number;
}

export interface StrikeRecord {
  count: number;
}
