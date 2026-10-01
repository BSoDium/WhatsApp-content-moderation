import type { AuditLogEntry, AuditLogPage, Contact, OverrideCommand, RosterEntry, ServerStatus, Setting, Stats } from '@/lib/types';
import { DEMO_PEOPLE, SELF_ID, SELF_NAME, type DemoPerson } from './people';
import { DEMO_POLICY_TEXT, DEMO_SETTINGS, validateSettingValue } from './settings';

export type ControlTopic = 'contacts' | 'roster' | 'settings' | 'policy' | 'audit-log';

export interface ContactState {
  person: DemoPerson;
  photoUrl: string | null;
  lastMessageAt: number | null;
  monitored: boolean;
  escalationEnabled: boolean;
  context: string | null;
  paused: boolean;
  strikeCount: number;
  lastStrikeAt: number | null;
  lastWarnAt: number | null;
  block: { unblockAt: number } | null;
  blockHistory: { startedAt: number; endsAt: number }[];
  callUnanswered: number;
  callStrikes: number;
  callThresholdOverride: number | null;
}

export type NewAuditEntry = Omit<AuditLogEntry, 'id' | 'contactName'>;

const DEFAULT_AUDIT_PAGE_LIMIT = 50;
const MAX_AUDIT_PAGE_LIMIT = 200;
const MAX_CONTEXT_LENGTH = 500;
const MAX_POLICY_LENGTH = 8000;
const FLAGGED_DELETED_ACTIONS: ReadonlySet<string> = new Set(['delete+warn', 'delete']);
const CATEGORY_ACTIONS: ReadonlySet<string> = new Set(['delete+warn', 'delete', 'shadow']);

export type CommandResult = { ok: true; body: unknown } | { ok: false; status: number; error: string };

export class DemoBackend {
  readonly startedAt: number;
  private readonly contacts = new Map<string, ContactState>();
  private readonly audit: AuditLogEntry[] = [];
  private readonly listeners = new Set<(topic: ControlTopic) => void>();
  private settings: Setting[] = DEMO_SETTINGS.map((definition) => ({ ...definition }));
  private policy = DEMO_POLICY_TEXT;
  private nextId = 1;

  constructor(now: number) {
    this.startedAt = now - (9 * 24 + 6) * 60 * 60 * 1000;
    DEMO_PEOPLE.forEach((person) => {
      this.contacts.set(person.id, {
        person,
        photoUrl: person.portraitUrl,
        lastMessageAt: null,
        monitored: person.monitored,
        escalationEnabled: true,
        context: person.context ?? null,
        paused: false,
        strikeCount: 0,
        lastStrikeAt: null,
        lastWarnAt: null,
        block: null,
        blockHistory: [],
        callUnanswered: 0,
        callStrikes: 0,
        callThresholdOverride: null,
      });
    });
  }

  subscribe(listener: (topic: ControlTopic) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  emit(topic: ControlTopic): void {
    for (const listener of this.listeners) listener(topic);
  }

  contact(id: string): ContactState | undefined {
    return this.contacts.get(id);
  }

  allContacts(): ContactState[] {
    return [...this.contacts.values()];
  }

  settingValue(key: string): string {
    return this.settings.find((setting) => setting.key === key)?.value ?? '';
  }

  settingNumber(key: string): number {
    return Number(this.settingValue(key));
  }

  settingBool(key: string): boolean {
    return this.settingValue(key) === '1';
  }

  callThreshold(state: ContactState): number {
    return state.callThresholdOverride ?? this.settingNumber('NUISANCE_CALL_THRESHOLD');
  }

  record(entry: NewAuditEntry): AuditLogEntry {
    const state = this.contacts.get(entry.contactId);
    const full: AuditLogEntry = { ...entry, id: this.nextId++, contactName: state?.person.name ?? entry.contactId };
    this.audit.push(full);
    if (state && entry.action !== 'warning_sent') state.lastMessageAt = Math.max(state.lastMessageAt ?? 0, entry.createdAt);
    return full;
  }

  expireBlocks(now: number): void {
    let changed = false;
    for (const state of this.contacts.values()) {
      if (state.block && state.block.unblockAt <= now) {
        state.block = null;
        changed = true;
      }
    }
    if (changed) this.emit('roster');
  }

  listContacts(now: number): Contact[] {
    this.expireBlocks(now);
    const self: Contact = { id: SELF_ID, name: SELF_NAME, lastMessageAt: null, isSelf: true, allowSelf: false };
    const others = [...this.contacts.values()].map((state) => ({
      id: state.person.id,
      name: state.person.name,
      lastMessageAt: state.lastMessageAt,
      isSelf: false,
      allowSelf: false,
      strikeCount: state.strikeCount,
      block: state.block,
      photoUrl: state.photoUrl,
    }));
    return [...others, self];
  }

  private rosterEntry(state: ContactState): RosterEntry {
    return {
      id: state.person.id,
      name: state.person.name,
      escalationEnabled: state.escalationEnabled,
      context: state.context,
      paused: state.paused,
      strikeCount: state.strikeCount,
      block: state.block,
      callNuisance: {
        unansweredCount: state.callUnanswered,
        strikeCount: state.callStrikes,
        threshold: this.callThreshold(state),
        thresholdOverride: state.callThresholdOverride,
      },
    };
  }

  listRoster(now: number): RosterEntry[] {
    this.expireBlocks(now);
    return [...this.contacts.values()].filter((state) => state.monitored).map((state) => this.rosterEntry(state));
  }

  stats(now: number): Stats {
    this.expireBlocks(now);
    const monitored = [...this.contacts.values()].filter((state) => state.monitored);
    const categories = new Map<string, number>();
    let flaggedDeleted = 0;
    let warningsSent = 0;
    let classifierErrors = 0;
    for (const entry of this.audit) {
      if (FLAGGED_DELETED_ACTIONS.has(entry.action)) flaggedDeleted++;
      if (entry.action === 'warning_sent') warningsSent++;
      if (entry.action === 'classifier_error') classifierErrors++;
      if (CATEGORY_ACTIONS.has(entry.action) && entry.flagged && entry.category) categories.set(entry.category, (categories.get(entry.category) ?? 0) + 1);
    }
    return {
      monitoredCount: monitored.length,
      activeBlocks: monitored.filter((state) => state.block).length,
      totalLogged: this.audit.length,
      totalFlaggedDeleted: flaggedDeleted,
      totalWarningsSent: warningsSent,
      totalClassifierErrors: classifierErrors,
      byCategory: [...categories].map(([category, count]) => ({ category, count })).sort((a, b) => b.count - a.count),
    };
  }

  auditPage(params: URLSearchParams): AuditLogPage {
    const requested = Number(params.get('limit'));
    const limit = Number.isInteger(requested) && requested > 0 ? Math.min(requested, MAX_AUDIT_PAGE_LIMIT) : DEFAULT_AUDIT_PAGE_LIMIT;
    const contactId = params.get('contactId');
    const action = params.get('action');
    const search = params.get('search')?.toLowerCase();
    const beforeRaw = Number(params.get('before'));
    const before = params.get('before') && Number.isInteger(beforeRaw) ? beforeRaw : undefined;

    const matching: AuditLogEntry[] = [];
    for (let index = this.audit.length - 1; index >= 0 && matching.length <= limit; index--) {
      const entry = this.audit[index];
      if (before !== undefined && entry.id >= before) continue;
      if (contactId && entry.contactId !== contactId) continue;
      if (action && entry.action !== action) continue;
      if (search && !entry.message.toLowerCase().includes(search)) continue;
      matching.push(entry);
    }
    const hasMore = matching.length > limit;
    const entries = hasMore ? matching.slice(0, limit) : matching;
    return { entries, nextBefore: hasMore ? entries[entries.length - 1].id : null };
  }

  status(now: number): ServerStatus {
    return {
      version: 'demo',
      startedAt: this.startedAt,
      serverTime: now,
      whatsapp: { status: 'open', since: now - 3 * 60 * 60 * 1000 - 12 * 60 * 1000, statusCode: null },
    };
  }

  listSettings(): Setting[] {
    return this.settings;
  }

  setSetting(key: string, value: string): CommandResult {
    const definition = this.settings.find((setting) => setting.key === key);
    if (!definition) return { ok: false, status: 400, error: `unknown setting: ${key}` };
    const error = validateSettingValue(definition, value);
    if (error) return { ok: false, status: 400, error };
    this.settings = this.settings.map((setting) => (setting.key === key ? { ...setting, value } : setting));
    this.emit('settings');
    return { ok: true, body: { key, value } };
  }

  getPolicy(): string {
    return this.policy;
  }

  setPolicy(text: string): CommandResult {
    if (text.length > MAX_POLICY_LENGTH) return { ok: false, status: 400, error: `text must be at most ${MAX_POLICY_LENGTH} characters` };
    this.policy = text;
    this.emit('policy');
    return { ok: true, body: { text } };
  }

  addToRoster(contactId: string): CommandResult {
    const state = this.contacts.get(contactId);
    if (!state) return { ok: false, status: 400, error: 'contactId must be an individual contact, not a group or broadcast list' };
    state.monitored = true;
    this.emit('roster');
    return { ok: true, body: this.rosterEntry(state) };
  }

  removeFromRoster(contactId: string): CommandResult {
    const state = this.contacts.get(contactId);
    if (!state?.monitored) return { ok: false, status: 404, error: 'not monitored' };
    state.monitored = false;
    this.emit('roster');
    return { ok: true, body: { removed: true } };
  }

  runOverride(contactId: string, command: OverrideCommand, now = Date.now()): CommandResult {
    const state = this.contacts.get(contactId);
    if (!state) return { ok: false, status: 404, error: 'not monitored' };
    const clearsState = command === 'reset-strikes' || command === 'unblock';
    if (!clearsState && !state.monitored) return { ok: false, status: 404, error: 'not monitored' };

    let message: string;
    if (command === 'pause') {
      state.paused = true;
      message = 'Moderation paused — incoming messages will not be classified or actioned until resumed.';
    } else if (command === 'resume') {
      state.paused = false;
      message = 'Moderation resumed.';
    } else if (command === 'reset-strikes') {
      Object.assign(state, { strikeCount: 0, lastStrikeAt: null, callStrikes: 0, callUnanswered: 0 });
      message = 'Strikes reset.';
    } else if (!state.block) {
      message = 'Contact is not currently blocked.';
    } else {
      state.block = null;
      const lastBlock = state.blockHistory.at(-1);
      if (lastBlock) lastBlock.endsAt = now;
      message = 'Contact unblocked.';
    }
    this.emit('roster');
    return { ok: true, body: { message, ...this.rosterEntry(state) } };
  }

  setEscalation(contactId: string, enabled: boolean): CommandResult {
    const state = this.contacts.get(contactId);
    if (!state?.monitored) return { ok: false, status: 404, error: 'not monitored' };
    state.escalationEnabled = enabled;
    this.emit('roster');
    return { ok: true, body: { escalationEnabled: enabled } };
  }

  setContext(contactId: string, context: string): CommandResult {
    const state = this.contacts.get(contactId);
    if (!state?.monitored) return { ok: false, status: 404, error: 'not monitored' };
    if (context.length > MAX_CONTEXT_LENGTH) return { ok: false, status: 400, error: `context must be at most ${MAX_CONTEXT_LENGTH} characters` };
    state.context = context.trim() === '' ? null : context.trim();
    this.emit('roster');
    return { ok: true, body: { context: state.context } };
  }

  setCallThreshold(contactId: string, threshold: number | null): CommandResult {
    const state = this.contacts.get(contactId);
    if (!state?.monitored) return { ok: false, status: 404, error: 'not monitored' };
    state.callThresholdOverride = threshold;
    this.emit('roster');
    return { ok: true, body: { callNuisance: this.rosterEntry(state).callNuisance } };
  }
}
