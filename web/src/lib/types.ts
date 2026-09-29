export interface Contact {
  id: string;
  name: string;
  lastMessageAt: number | null;
  // The account's own contact, and whether TEST_ALLOW_SELF is on; moderating it would be a no-op, so the UI disables the switch.
  isSelf: boolean;
  allowSelf: boolean;
  strikeCount?: number;
  block?: { unblockAt: number } | null;
  // A same-origin proxy path, never a raw WhatsApp CDN URL; the route can still 404, which the avatar falls back from.
  photoUrl?: string | null;
}

export interface RosterEntry {
  id: string;
  name: string;
  escalationEnabled: boolean;
  context: string | null;
  paused: boolean;
  strikeCount: number;
  block: { unblockAt: number } | null;
  callNuisance: { unansweredCount: number; strikeCount: number; threshold: number; thresholdOverride: number | null };
}

// Matches src/store/settings.ts's SettingDef/SettingView shape.
export interface Setting {
  key: string;
  section: 'general' | 'classifier' | 'warning' | 'strikes' | 'calls';
  label: string;
  description: string;
  type: 'string' | 'int' | 'float' | 'bool';
  value: string;
  default: string;
  // Mirrors SettingDef in src/store/settings.ts, for client-side validation.
  min?: number;
  required?: boolean;
}

// Matches GET /api/meta.
export interface SignedInUser {
  login: string;
  name: string;
  pictureUrl: string | null;
  tailnet: string | null;
}

export interface Meta {
  authRequired: boolean;
  user: SignedInUser | null;
}

export interface ControlError {
  title: string;
  description: string;
  retry?: () => void | Promise<void>;
}

export type OverrideCommand = 'pause' | 'resume' | 'unblock';

export interface Stats {
  monitoredCount: number;
  activeBlocks: number;
  totalLogged: number;
  totalFlaggedDeleted: number;
  totalWarningsSent: number;
  totalClassifierErrors: number;
  byCategory: { category: string; count: number }[];
}

// Matches every action moderation-pipeline.ts/call-pipeline.ts's logMessage() can record.
export type AuditAction =
  | 'none'
  | 'delete+warn'
  | 'warning_sent'
  | 'classifier_error'
  | 'action_failed'
  | 'shadow'
  | 'call_received'
  | 'call_unanswered'
  | 'call_answered'
  | 'call_nuisance_warned'
  | 'call_reject_failed'
  | 'call_warn_failed'
  | 'call_shadow';

export interface AuditLogEntry {
  id: number;
  contactId: string;
  contactName: string;
  direction: 'me' | 'them';
  message: string;
  classificationOk: boolean;
  flagged: boolean | null;
  category: string | null;
  reason: string | null;
  error: string | null;
  action: AuditAction;
  createdAt: number;
}

export interface AuditLogPage {
  entries: AuditLogEntry[];
  nextBefore: number | null;
}
