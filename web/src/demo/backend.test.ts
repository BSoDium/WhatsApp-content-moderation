import { describe, expect, it } from 'vitest';
import { DemoBackend } from './backend';
import { ingestFlagged } from './engine';
import { createSeededBackend } from './history';
import { FLAGGED_INCOMING } from './messages';
import { DEMO_PEOPLE } from './people';
import { createRandom } from './random';

const NOW = Date.UTC(2026, 8, 30, 12, 0, 0);

function firstMonitored(kind: string) {
  const person = DEMO_PEOPLE.find((candidate) => candidate.kind === kind && candidate.monitored);
  if (!person) throw new Error(`no monitored ${kind} in the demo roster`);
  return person;
}

describe('seeded demo backend', () => {
  const backend = createSeededBackend(NOW);

  it('builds a large, consistent history', () => {
    const { entries } = backend.auditPage(new URLSearchParams({ limit: '200' }));
    expect(backend.stats(NOW).totalLogged).toBeGreaterThan(500);
    expect(new Set(entries.map((entry) => entry.id)).size).toBe(entries.length);
  });

  it('pages through the whole log without gaps or repeats', () => {
    const seen = new Set<number>();
    let before: number | null = null;
    do {
      const params: URLSearchParams = new URLSearchParams({ limit: '100' });
      if (before !== null) params.set('before', String(before));
      const page = backend.auditPage(params);
      for (const entry of page.entries) {
        expect(seen.has(entry.id)).toBe(false);
        seen.add(entry.id);
      }
      before = page.nextBefore;
    } while (before !== null);
    expect(seen.size).toBe(backend.stats(NOW).totalLogged);
  });

  it('leaves at least one contact blocked and one paused for the screenshots', () => {
    const roster = backend.listRoster(NOW);
    expect(roster.some((entry) => entry.block)).toBe(true);
    expect(roster.some((entry) => entry.paused)).toBe(true);
  });

  it('gives every contact photo a distinct face', () => {
    const urls = DEMO_PEOPLE.flatMap((person) => (person.portraitUrl ? [person.portraitUrl] : []));
    expect(urls.length).toBeGreaterThan(20);
    expect(new Set(urls).size).toBe(urls.length);
  });

  it('only uses fictional phone numbers', () => {
    for (const person of DEMO_PEOPLE) expect(person.id).toMatch(/^3363998\d{4}@s\.whatsapp\.net$/);
  });
});

describe('strike engine', () => {
  it('blocks a contact after the strike threshold and ends the block when it expires', () => {
    const backend = new DemoBackend(NOW);
    backend.setSetting('SHADOW_MODE', '0');
    const person = firstMonitored('spammer');
    const random = createRandom(1);
    const template = FLAGGED_INCOMING.spammer[0];
    const strikeGapMs = backend.settingNumber('STRIKE_COOLDOWN_MS') + 1000;

    for (let strike = 0; strike < backend.settingNumber('STRIKE_THRESHOLD'); strike++) {
      ingestFlagged(backend, person.id, template, NOW + strike * strikeGapMs, random);
    }
    const blocked = backend.contact(person.id)?.block;
    expect(blocked).not.toBeNull();

    backend.expireBlocks((blocked?.unblockAt ?? NOW) + 1);
    expect(backend.contact(person.id)?.block).toBeNull();
  });

  it('grows repeat blocks from the real unblock time and resets after a long gap', () => {
    const hourMs = 60 * 60 * 1000;
    const backend = new DemoBackend(NOW);
    backend.setSetting('SHADOW_MODE', '0');
    backend.setSetting('BLOCK_BACKOFF', '1');
    const person = firstMonitored('spammer');
    const random = createRandom(1);
    const template = FLAGGED_INCOMING.spammer[0];
    const strikeGapMs = backend.settingNumber('STRIKE_COOLDOWN_MS') + 1000;
    const threshold = backend.settingNumber('STRIKE_THRESHOLD');

    function blockLengthFrom(start: number): number {
      let at = start;
      for (let strike = 0; strike < threshold; strike++) {
        at = start + strike * strikeGapMs;
        ingestFlagged(backend, person.id, template, at, random);
      }
      return (backend.contact(person.id)?.block?.unblockAt ?? 0) - at;
    }

    const first = blockLengthFrom(NOW);
    expect(first).toBeGreaterThanOrEqual(3 * hourMs * 0.75);
    expect(first).toBeLessThanOrEqual(3 * hourMs * 1.25);

    backend.runOverride(person.id, 'unblock', NOW + hourMs);
    const second = blockLengthFrom(NOW + 2 * hourMs);
    expect(second).toBeGreaterThanOrEqual(6 * hourMs * 0.75);
    expect(second).toBeLessThanOrEqual(6 * hourMs * 1.25);

    const resetMs = backend.settingNumber('BLOCK_BACKOFF_RESET_MS');
    backend.runOverride(person.id, 'unblock', NOW + 3 * hourMs);
    const afterReset = blockLengthFrom(NOW + 3 * hourMs + resetMs + hourMs);
    expect(afterReset).toBeLessThanOrEqual(3 * hourMs * 1.25);
  });

  it('logs a grouped delete, not a new strike, inside the cooldown', () => {
    const backend = new DemoBackend(NOW);
    backend.setSetting('SHADOW_MODE', '0');
    const person = firstMonitored('harasser');
    const random = createRandom(2);
    const template = FLAGGED_INCOMING.harasser[0];

    ingestFlagged(backend, person.id, template, NOW, random);
    ingestFlagged(backend, person.id, template, NOW + 30_000, random);

    expect(backend.contact(person.id)?.strikeCount).toBe(1);
    const actions = backend.auditPage(new URLSearchParams()).entries.map((entry) => entry.action);
    expect(actions).toContain('delete');
  });

  it('changes nothing but the log in shadow mode', () => {
    const backend = new DemoBackend(NOW);
    backend.setSetting('SHADOW_MODE', '1');
    const person = firstMonitored('scammer');

    ingestFlagged(backend, person.id, FLAGGED_INCOMING.scammer[0], NOW, createRandom(3));

    expect(backend.contact(person.id)?.strikeCount).toBe(0);
    expect(backend.auditPage(new URLSearchParams()).entries[0].action).toBe('shadow');
  });
});
