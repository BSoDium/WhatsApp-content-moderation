import type { AuditAction, AuditLogEntry } from '@/lib/types';
import type { ContactState, DemoBackend } from './backend';
import { CALL_WARNING_TEMPLATE, CLASSIFIER_ERRORS, GENERATED_WARNINGS, type FlaggedTemplate, type PassedTemplate } from './messages';
import type { Random } from './random';

export const WARNING_DELAY_MS = 2000;
export const CALL_OUTCOME_DELAY_MS = 18_000;
const ENGLISH_HINT = /\b(the|you|your|dear|hello|hi|is|are|last chance|answer)\b/i;

interface EntryFields {
  direction?: AuditLogEntry['direction'];
  message: string;
  classificationOk?: boolean;
  flagged?: boolean | null;
  category?: string | null;
  reason?: string | null;
  error?: string | null;
  action: AuditAction;
}

function log(backend: DemoBackend, contactId: string, at: number, fields: EntryFields): void {
  backend.record({
    contactId,
    direction: fields.direction ?? 'them',
    message: fields.message,
    classificationOk: fields.classificationOk ?? true,
    flagged: fields.flagged ?? null,
    category: fields.category ?? null,
    reason: fields.reason ?? null,
    error: fields.error ?? null,
    action: fields.action,
    createdAt: at,
  });
}

function isBlocked(state: ContactState, at: number): boolean {
  return state.block !== null && state.block.unblockAt > at;
}

// A paused, unmoderated or blocked contact's traffic is never classified, so it leaves no audit row.
function isModerated(state: ContactState | undefined, at: number): state is ContactState {
  return state !== undefined && state.monitored && !state.paused && !isBlocked(state, at);
}

function touch(state: ContactState, at: number): void {
  state.lastMessageAt = Math.max(state.lastMessageAt ?? 0, at);
}

function decayStrikes(backend: DemoBackend, state: ContactState, at: number): void {
  const decayMs = backend.settingNumber('STRIKE_DECAY_MS');
  if (decayMs <= 0 || state.lastStrikeAt === null || state.strikeCount === 0) return;
  const forgiven = Math.floor((at - state.lastStrikeAt) / decayMs);
  if (forgiven <= 0) return;
  state.strikeCount = Math.max(0, state.strikeCount - forgiven);
  state.lastStrikeAt += forgiven * decayMs;
}

function startBlock(backend: DemoBackend, state: ContactState, at: number, random: Random): void {
  const jitter = backend.settingNumber('BLOCK_JITTER_MS');
  const duration = backend.settingNumber('BLOCK_DURATION_MS') + Math.round((random.next() * 2 - 1) * jitter);
  state.block = { unblockAt: at + Math.max(duration, 1) };
  state.strikeCount = 0;
  state.lastStrikeAt = null;
  state.callStrikes = 0;
  state.callUnanswered = 0;
}

export function ingestPassed(backend: DemoBackend, contactId: string, template: PassedTemplate, at: number): void {
  const state = backend.contact(contactId);
  if (!state) return;
  touch(state, at);
  if (!isModerated(state, at)) return;
  const shadow = backend.settingBool('SHADOW_MODE');
  log(backend, contactId, at, { message: template.message, flagged: false, category: 'none', reason: template.reason, action: shadow ? 'shadow' : 'none' });
  backend.emit('audit-log');
  backend.emit('contacts');
}

export function ingestOutgoing(backend: DemoBackend, contactId: string, message: string, at: number): void {
  const state = backend.contact(contactId);
  if (!state) return;
  touch(state, at);
  if (!state.monitored) return;
  log(backend, contactId, at, { direction: 'me', message, action: 'outgoing' });
  backend.emit('audit-log');
  backend.emit('contacts');
}

export function ingestClassifierError(backend: DemoBackend, contactId: string, message: string, at: number, random: Random): void {
  const state = backend.contact(contactId);
  if (!state) return;
  touch(state, at);
  if (!isModerated(state, at)) return;
  log(backend, contactId, at, { message, classificationOk: false, error: random.pick(CLASSIFIER_ERRORS), action: 'classifier_error' });
  backend.emit('audit-log');
}

export function ingestFlagged(backend: DemoBackend, contactId: string, template: FlaggedTemplate, at: number, random: Random): void {
  const state = backend.contact(contactId);
  if (!state) return;
  touch(state, at);
  if (!isModerated(state, at)) return;

  const verdict = { message: template.message, flagged: true, category: template.category, reason: template.reason };
  if (backend.settingBool('SHADOW_MODE')) {
    log(backend, contactId, at, { ...verdict, action: 'shadow' });
  } else {
    const cooldown = backend.settingNumber('STRIKE_COOLDOWN_MS');
    const coolingDown = cooldown > 0 && state.lastWarnAt !== null && at - state.lastWarnAt < cooldown;
    if (coolingDown) {
      log(backend, contactId, at, { ...verdict, action: 'delete' });
    } else {
      decayStrikes(backend, state, at);
      state.strikeCount++;
      state.lastStrikeAt = at;
      state.lastWarnAt = at;
      log(backend, contactId, at, { ...verdict, action: 'delete+warn' });
      log(backend, contactId, at + WARNING_DELAY_MS, { direction: 'me', message: random.pick(ENGLISH_HINT.test(template.message) ? GENERATED_WARNINGS.en : GENERATED_WARNINGS.fr), action: 'warning_sent' });
      if (state.strikeCount >= backend.settingNumber('STRIKE_THRESHOLD')) startBlock(backend, state, at, random);
    }
  }
  backend.emit('audit-log');
  backend.emit('roster');
  backend.emit('contacts');
}

export function ingestCall(backend: DemoBackend, contactId: string, at: number, random: Random, answered: boolean): void {
  const state = backend.contact(contactId);
  if (!state) return;
  touch(state, at);
  if (!isModerated(state, at)) return;

  const message = random.chance(0.3) ? '[video call]' : '[voice call]';
  const outcomeAt = at + CALL_OUTCOME_DELAY_MS;
  log(backend, contactId, at, { message, action: 'call_received' });

  if (answered) {
    state.callUnanswered = 0;
    log(backend, contactId, outcomeAt, { message, action: 'call_answered' });
  } else if (backend.settingBool('SHADOW_MODE')) {
    const nuisance = state.callUnanswered >= backend.callThreshold(state);
    state.callUnanswered++;
    log(backend, contactId, outcomeAt, { message, flagged: nuisance, action: 'call_shadow' });
  } else {
    const nuisance = state.callUnanswered >= backend.callThreshold(state);
    state.callUnanswered++;
    if (nuisance) {
      state.callStrikes++;
      const warning = CALL_WARNING_TEMPLATE.replace('{strikes}', String(state.callStrikes)).replace('{threshold}', String(backend.settingNumber('NUISANCE_CALL_STRIKE_THRESHOLD')));
      log(backend, contactId, outcomeAt, { message, flagged: true, action: 'call_nuisance_warned' });
      log(backend, contactId, outcomeAt + WARNING_DELAY_MS, { direction: 'me', message: warning, action: 'warning_sent' });
      if (state.callStrikes >= backend.settingNumber('NUISANCE_CALL_STRIKE_THRESHOLD')) startBlock(backend, state, outcomeAt, random);
    } else {
      log(backend, contactId, outcomeAt, { message, action: 'call_unanswered' });
    }
  }
  backend.emit('audit-log');
  backend.emit('roster');
  backend.emit('contacts');
}
