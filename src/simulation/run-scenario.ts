import { setTimeout as sleep } from 'node:timers/promises';
import { createMessageBuffer } from '../buffer/message-buffer.ts';
import { DEFAULT_POLICY_TEXT, setPolicyText } from '../classifier/policy.ts';
import { handleBurst, pendingBursts } from '../pipeline/moderation-pipeline.ts';
import { getAuditLog } from '../store/audit-log.ts';
import { addMonitored } from '../store/monitored-contacts.ts';
import { getStrikeCount } from '../store/strikes.ts';
import { SETTINGS, setSetting } from '../store/settings.ts';
import type { classifyMessage } from '../classifier/classifier.ts';
import type { generateWarningMessage } from '../classifier/warning-message.ts';
import type { AuditLogRecord, IncomingMessage } from '../types.ts';
import type { Scenario, ScenarioExpectation } from './scenario.ts';

export interface SimulationEvent {
  atMs: number;
  kind: 'incoming' | 'deleted' | 'warning' | 'block';
  text: string;
}

export interface ScenarioOutcome {
  events: SimulationEvent[];
  rows: AuditLogRecord[];
  counts: Required<ScenarioExpectation>;
}

export interface ScenarioDependencies {
  classify?: typeof classifyMessage;
  generateWarning?: typeof generateWarningMessage;
  settingsOverride?: Record<string, string>;
}

const SIMULATION_SETTINGS: Record<string, string> = { SHADOW_MODE: '0' };

// Back to manifest defaults first, so one scenario's settings never leak into the next run in the same process.
function applySettings(settings: Record<string, string>): void {
  for (const def of SETTINGS) setSetting(def.key, def.default);
  for (const [key, value] of Object.entries({ ...SIMULATION_SETTINGS, ...settings })) {
    const result = setSetting(key, value);
    if (!result.ok) throw new Error(`scenario setting ${key}: ${result.error}`);
  }
}

/**
 * Replays a scenario through the real message buffer and moderation pipeline
 * against whatever database DB_PATH points at (callers set it to a throwaway
 * file before importing this module). Only the WhatsApp side is faked: the
 * delete, warning and block actions are recorded instead of sent. Message
 * delays are real time, so scenarios use scaled-down BUFFER_WINDOW_MS and
 * STRIKE_COOLDOWN_MS in `settings` rather than minutes.
 */
export async function runScenario(scenario: Scenario, contactId: string, { classify, generateWarning, settingsOverride = {} }: ScenarioDependencies = {}): Promise<ScenarioOutcome> {
  applySettings({ ...scenario.settings, ...settingsOverride });
  setPolicyText(scenario.policy ?? DEFAULT_POLICY_TEXT);
  addMonitored(contactId);

  const startedAt = Date.now();
  const events: SimulationEvent[] = [];
  const textByKeyId = new Map<string, string>();
  const record = (kind: SimulationEvent['kind'], text: string) => events.push({ atMs: Date.now() - startedAt, kind, text });

  const buffer = createMessageBuffer<IncomingMessage>(async (jid, messages) => {
    await handleBurst(
      { contactId: jid, messages },
      {
        deleteForMe: async (_jid, key) => record('deleted', textByKeyId.get(String(key.id)) ?? ''),
        sendWarning: async (_jid, text) => record('warning', text),
        block: async () => record('block', ''),
        classify,
        generateWarning,
      },
    );
  });

  for (const [index, { text, afterMs = 0 }] of scenario.messages.entries()) {
    await sleep(afterMs);
    const id = `sim-${index}`;
    textByKeyId.set(id, text);
    record('incoming', text);
    buffer.push(contactId, { text, key: { id }, timestamp: Date.now() });
  }
  await buffer.flushAll();
  await Promise.all(pendingBursts());

  const countOf = (kind: SimulationEvent['kind']) => events.filter((event) => event.kind === kind).length;
  return {
    events,
    rows: getAuditLog(contactId, scenario.messages.length * 3).reverse(),
    counts: { strikes: getStrikeCount(contactId), warnings: countOf('warning'), deletions: countOf('deleted'), blocks: countOf('block') },
  };
}

export function checkExpectations(outcome: ScenarioOutcome, expect: ScenarioExpectation = {}): string[] {
  return (Object.keys(expect) as (keyof ScenarioExpectation)[])
    .filter((key) => outcome.counts[key] !== expect[key])
    .map((key) => `${key}: expected ${expect[key]}, got ${outcome.counts[key]}`);
}
