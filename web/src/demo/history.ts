import { DemoBackend } from './backend';
import { ingestCall, ingestClassifierError, ingestFlagged, ingestOutgoing, ingestPassed } from './engine';
import { FLAGGED_INCOMING, OUTGOING_REPLIES, PASSED_INCOMING, type FlaggedTemplate, type PassedTemplate } from './messages';
import { DEMO_PEOPLE, type DemoPerson } from './people';
import { createRandom, type Random } from './random';

const MINUTE_MS = 60_000;
const HOUR_MS = 60 * MINUTE_MS;
const DAY_MS = 24 * HOUR_MS;
const HISTORY_DAYS = 30;
const SHADOW_ONBOARDING_DAYS = 4;
const RECENT_WINDOW_MS = 30 * HOUR_MS;
const SEED = 20260930;
const CLASSIFIER_ERROR_RATE = 0.012;
const REPLY_RATE = 0.65;
const ACTIVE_HOURS = [8, 9, 10, 11, 12, 12, 13, 14, 15, 16, 17, 18, 18, 19, 19, 20, 20, 21, 22, 23];
const BURST_SPACING_MS = { min: 20_000, max: 200_000 };

const BURST_COUNTS: Partial<Record<DemoPerson['kind'], { min: number; max: number }>> = {
  spammer: { min: 4, max: 7 },
  scammer: { min: 3, max: 6 },
  harasser: { min: 5, max: 9 },
  stranger: { min: 1, max: 1 },
};

const CHATTY_COUNTS: Partial<Record<DemoPerson['kind'], { min: number; max: number }>> = {
  friend: { min: 50, max: 90 },
  family: { min: 34, max: 60 },
  colleague: { min: 40, max: 70 },
  shop: { min: 8, max: 14 },
  stranger: { min: 6, max: 12 },
};

// Hours ago of each burst; three spaced strikes inside the decay window put a contact in an active block.
const FORCED_BURSTS_HOURS_AGO: Record<string, number[]> = {
  '33639980021': [7.5, 4.2, 1.6],
  '33639980040': [9, 5.5, 2.4],
  '33639980034': [10, 6, 2.9],
  '33639980020': [6.2, 2.1],
  '33639980030': [0.8],
  '33639980043': [3.4],
};

const FORCED_CALLS_MINUTES_AGO: Record<string, number[]> = {
  '33639980022': [150, 110, 70, 35],
  '33639980021': [200, 95],
};

const ANSWERED_CALLERS = new Set(['33639980061', '33639980060', '33639980063']);

interface HistoryEvent {
  at: number;
  run: () => void;
}

function digits(person: DemoPerson): string {
  return person.id.split('@')[0];
}

function randomPastTime(random: Random, now: number, maxAgeMs: number, minAgeMs: number): number {
  const day = new Date(now - random.int(0, Math.floor(maxAgeMs / DAY_MS)) * DAY_MS);
  day.setHours(random.pick(ACTIVE_HOURS), random.int(0, 59), random.int(0, 59), 0);
  const at = day.getTime();
  return at > now - minAgeMs || at < now - maxAgeMs ? now - random.int(minAgeMs, minAgeMs + DAY_MS) : at;
}

function templatesFor(person: DemoPerson): PassedTemplate[] {
  if (person.kind === 'friend' && person.name.startsWith('Pierre')) return [...PASSED_INCOMING.friend, ...PASSED_INCOMING.banter, ...PASSED_INCOMING.banter];
  if (person.kind === 'friend' || person.kind === 'family' || person.kind === 'colleague' || person.kind === 'shop' || person.kind === 'stranger') return PASSED_INCOMING[person.kind];
  return [];
}

function flaggedTemplatesFor(person: DemoPerson): FlaggedTemplate[] {
  if (person.kind === 'spammer' || person.kind === 'scammer' || person.kind === 'harasser' || person.kind === 'stranger') return FLAGGED_INCOMING[person.kind];
  return [];
}

function burstEvents(backend: DemoBackend, person: DemoPerson, start: number, random: Random): HistoryEvent[] {
  const templates = flaggedTemplatesFor(person);
  const size = random.int(1, 4);
  const events: HistoryEvent[] = [];
  let at = start;
  for (let index = 0; index < size; index++) {
    const template = random.pick(templates);
    events.push({ at, run: () => ingestFlagged(backend, person.id, template, at, random) });
    at += random.int(BURST_SPACING_MS.min, BURST_SPACING_MS.max);
  }
  return events;
}

function conversationEvents(backend: DemoBackend, person: DemoPerson, now: number, random: Random): HistoryEvent[] {
  const count = CHATTY_COUNTS[person.kind];
  const templates = templatesFor(person);
  if (!count || templates.length === 0) return [];
  const events: HistoryEvent[] = [];
  const total = random.int(count.min, count.max);
  for (let index = 0; index < total; index++) {
    const at = randomPastTime(random, now, HISTORY_DAYS * DAY_MS, 20 * MINUTE_MS);
    const template = random.pick(templates);
    if (random.chance(CLASSIFIER_ERROR_RATE * 4)) {
      events.push({ at, run: () => ingestClassifierError(backend, person.id, template.message, at, random) });
    } else {
      events.push({ at, run: () => ingestPassed(backend, person.id, template, at) });
    }
    if (person.kind !== 'shop' && random.chance(REPLY_RATE)) {
      const replyAt = at + random.int(MINUTE_MS, 12 * MINUTE_MS);
      const reply = random.pick(OUTGOING_REPLIES);
      events.push({ at: replyAt, run: () => ingestOutgoing(backend, person.id, reply, replyAt) });
    }
  }
  return events;
}

function troublemakerEvents(backend: DemoBackend, person: DemoPerson, now: number, random: Random): HistoryEvent[] {
  const range = BURST_COUNTS[person.kind];
  if (!range || flaggedTemplatesFor(person).length === 0) return [];
  const forced = FORCED_BURSTS_HOURS_AGO[digits(person)];
  const events: HistoryEvent[] = [];
  const bursts = random.int(range.min, range.max);
  const newestAllowedAge = forced ? RECENT_WINDOW_MS : 40 * MINUTE_MS;
  for (let index = 0; index < bursts; index++) {
    events.push(...burstEvents(backend, person, randomPastTime(random, now, HISTORY_DAYS * DAY_MS, newestAllowedAge), random));
  }
  for (const hoursAgo of forced ?? []) events.push(...burstEvents(backend, person, now - hoursAgo * HOUR_MS, random));
  return events;
}

function callEvents(backend: DemoBackend, person: DemoPerson, now: number, random: Random): HistoryEvent[] {
  const events: HistoryEvent[] = [];
  for (const minutesAgo of FORCED_CALLS_MINUTES_AGO[digits(person)] ?? []) {
    const at = now - minutesAgo * MINUTE_MS;
    events.push({ at, run: () => ingestCall(backend, person.id, at, random, false) });
  }
  if (ANSWERED_CALLERS.has(digits(person))) {
    for (let index = 0; index < random.int(3, 6); index++) {
      const at = randomPastTime(random, now, HISTORY_DAYS * DAY_MS, HOUR_MS);
      events.push({ at, run: () => ingestCall(backend, person.id, at, random, true) });
    }
  }
  return events;
}

function scatterUnmoderatedActivity(backend: DemoBackend, now: number, random: Random): void {
  for (const state of backend.allContacts()) {
    if (state.monitored) continue;
    const recent = random.chance(0.35);
    state.lastMessageAt = now - (recent ? random.int(2 * MINUTE_MS, 6 * HOUR_MS) : random.int(6 * HOUR_MS, 20 * DAY_MS));
  }
}

export function createSeededBackend(now: number): DemoBackend {
  const backend = new DemoBackend(now);
  const random = createRandom(SEED);
  const shadowEndsAt = now - (HISTORY_DAYS - SHADOW_ONBOARDING_DAYS) * DAY_MS;

  const events = DEMO_PEOPLE.filter((person) => person.monitored).flatMap((person) => [
    ...conversationEvents(backend, person, now, random),
    ...troublemakerEvents(backend, person, now, random),
    ...callEvents(backend, person, now, random),
  ]);
  events.sort((a, b) => a.at - b.at);

  for (const event of events) {
    backend.expireBlocks(event.at);
    backend.setSetting('SHADOW_MODE', event.at < shadowEndsAt ? '1' : '0');
    event.run();
  }
  backend.setSetting('SHADOW_MODE', '0');
  backend.expireBlocks(now);
  scatterUnmoderatedActivity(backend, now, random);
  applyFinishingTouches(backend);
  return backend;
}

function applyFinishingTouches(backend: DemoBackend): void {
  const byName = (name: string) => backend.allContacts().find((state) => state.person.name === name);
  const pierre = byName('Pierre Delattre');
  if (pierre) pierre.escalationEnabled = false;
  const yasmine = byName('Yasmine Kadri');
  if (yasmine) {
    yasmine.paused = true;
    yasmine.callThresholdOverride = 5;
  }
}
