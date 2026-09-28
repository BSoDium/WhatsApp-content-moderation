import { asc, eq, sql } from 'drizzle-orm';
import { getOrm } from './db.ts';
import { emitControlEvent } from './events.ts';
import { monitoredContacts } from './schema.ts';
import { getNumberSetting } from './settings.ts';
import type { MonitoredContactRecord } from '../types.ts';

export interface MonitoredContact {
  contactId: string;
  escalationEnabled: boolean;
  addedAt: number;
  context: string | null;
  callNuisanceThreshold: number | null;
}

function toMonitoredContact(row: MonitoredContactRecord): MonitoredContact {
  return {
    contactId: row.contact_id,
    escalationEnabled: Boolean(row.escalation_enabled),
    addedAt: row.added_at,
    context: row.context,
    callNuisanceThreshold: row.call_nuisance_threshold,
  };
}

/**
 * Returns the full roster of monitored contacts, oldest-added first.
 */
export function listMonitored(): MonitoredContact[] {
  return getOrm()
    .select()
    .from(monitoredContacts)
    .orderBy(asc(monitoredContacts.added_at), asc(sql`rowid`))
    .all()
    .map(toMonitoredContact);
}

export function isMonitored(contactId: string): boolean {
  return getOrm()
    .select({ contact_id: monitoredContacts.contact_id })
    .from(monitoredContacts)
    .where(eq(monitoredContacts.contact_id, contactId))
    .get() !== undefined;
}

/**
 * @returns {{ contactId: string, escalationEnabled: boolean, addedAt: number, context: string | null } | undefined}
 */
export function getMonitored(contactId: string): MonitoredContact | undefined {
  const row = getOrm().select().from(monitoredContacts).where(eq(monitoredContacts.contact_id, contactId)).get();
  return row ? toMonitoredContact(row) : undefined;
}

/**
 * Adds a contact to the roster with escalation on by default. Idempotent —
 * a contact already on the roster keeps its current escalation_enabled
 * value rather than being reset to the default.
 */
export function addMonitored(contactId: string): void {
  getOrm()
    .insert(monitoredContacts)
    .values({ contact_id: contactId, escalation_enabled: 1, added_at: Date.now() })
    .onConflictDoNothing({ target: monitoredContacts.contact_id })
    .run();
  emitControlEvent('roster');
}

/**
 * Removes a contact from the roster only — its strikes/blocks/audit-log
 * rows are untouched, see docs/decisions.md's audit-log permanence
 * principle.
 *
 * @returns {boolean} whether a roster row was actually removed
 */
export function removeMonitored(contactId: string): boolean {
  const { changes } = getOrm().delete(monitoredContacts).where(eq(monitoredContacts.contact_id, contactId)).run();
  if (changes > 0) emitControlEvent('roster');
  return changes > 0;
}

/**
 * @returns {boolean} whether contactId was on the roster to update
 */
export function setEscalationEnabled(contactId: string, enabled: boolean): boolean {
  const { changes } = getOrm()
    .update(monitoredContacts)
    .set({ escalation_enabled: enabled ? 1 : 0 })
    .where(eq(monitoredContacts.contact_id, contactId))
    .run();
  if (changes > 0) emitControlEvent('roster');
  return changes > 0;
}

/**
 * Sets or clears a contact's moderation context — free-text guidance folded
 * into the classifier prompt alongside the global policy (see
 * classifier.ts's buildSystemPrompt). An empty string is normalized to null:
 * "no context" and "empty context" are the same state. Deleted along with
 * the roster row on removeMonitored, same lifecycle as escalation_enabled.
 *
 * @returns {boolean} whether contactId was on the roster to update
 */
export function setContext(contactId: string, context: string | null): boolean {
  const normalized = context?.trim() ? context.trim() : null;
  const { changes } = getOrm()
    .update(monitoredContacts)
    .set({ context: normalized })
    .where(eq(monitoredContacts.contact_id, contactId))
    .run();
  if (changes > 0) emitControlEvent('roster');
  return changes > 0;
}

/**
 * Sets or clears a contact's per-contact nuisance-call threshold override —
 * null falls back to the global NUISANCE_CALL_THRESHOLD setting, same
 * null-means-default convention as setContext above.
 *
 * @returns {boolean} whether contactId was on the roster to update
 */
export function setCallNuisanceThreshold(contactId: string, threshold: number | null): boolean {
  const { changes } = getOrm()
    .update(monitoredContacts)
    .set({ call_nuisance_threshold: threshold })
    .where(eq(monitoredContacts.contact_id, contactId))
    .run();
  if (changes > 0) emitControlEvent('roster');
  return changes > 0;
}

/**
 * Resolves the nuisance-call threshold that actually applies to contactId:
 * their own override if set, otherwise the global default.
 */
export function getEffectiveNuisanceThreshold(contactId: string): number {
  const row = getOrm()
    .select({ call_nuisance_threshold: monitoredContacts.call_nuisance_threshold })
    .from(monitoredContacts)
    .where(eq(monitoredContacts.contact_id, contactId))
    .get();
  return row?.call_nuisance_threshold ?? getNumberSetting('NUISANCE_CALL_THRESHOLD');
}

/**
 * Defaults to false for a contactId with no roster row — the only way
 * maybeBlockContact reaches this with an unknown contactId is a contact
 * removed from the roster while a burst for them was already buffered or
 * in flight, and a block is the wrong thing to fail toward for a contact
 * the operator just stopped monitoring.
 */
export function isEscalationEnabled(contactId: string): boolean {
  const row = getOrm()
    .select({ escalation_enabled: monitoredContacts.escalation_enabled })
    .from(monitoredContacts)
    .where(eq(monitoredContacts.contact_id, contactId))
    .get();
  return row ? Boolean(row.escalation_enabled) : false;
}
