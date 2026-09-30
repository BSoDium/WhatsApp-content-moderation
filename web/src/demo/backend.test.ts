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
