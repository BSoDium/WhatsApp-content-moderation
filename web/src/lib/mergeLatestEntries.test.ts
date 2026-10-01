import { describe, expect, it } from 'vitest';
import { mergeLatestEntries } from './mergeLatestEntries';
import type { AuditLogEntry } from './types';

function entry(id: number, message = `m${id}`): AuditLogEntry {
  return { id, message } as AuditLogEntry;
}

describe('mergeLatestEntries', () => {
  it('puts new entries first and keeps older loaded ones', () => {
    const merged = mergeLatestEntries([entry(3), entry(2), entry(1)], [entry(4), entry(3)]);
    expect(merged.map((e) => e.id)).toEqual([4, 3, 2, 1]);
  });

  it('prefers the refetched copy of an entry already shown', () => {
    const merged = mergeLatestEntries([entry(1, 'old')], [entry(1, 'new')]);
    expect(merged).toEqual([entry(1, 'new')]);
  });

  it('returns the latest page when nothing is shown yet', () => {
    expect(mergeLatestEntries([], [entry(2), entry(1)]).map((e) => e.id)).toEqual([2, 1]);
  });
});
