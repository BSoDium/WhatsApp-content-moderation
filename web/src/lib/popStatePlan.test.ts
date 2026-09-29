import { describe, expect, it } from 'vitest';
import { planPopState } from './popStatePlan';
import type { UrlState } from './urlState';

const LIST: UrlState = { contactId: null, openPanel: null, activityContactId: null };
const ALICE: UrlState = { contactId: 'alice', openPanel: null, activityContactId: null };
const BOB_ACTIVITY: UrlState = { contactId: 'bob', openPanel: 'activity', activityContactId: 'bob' };

describe('planPopState', () => {
  it('ignores landing on the state already shown', () => {
    expect(planPopState({ target: ALICE, current: ALICE, hasUnsavedDraft: true, previousIndex: 1, index: 1 })).toEqual({ kind: 'ignore' });
  });

  it('applies a plain navigation', () => {
    expect(planPopState({ target: LIST, current: ALICE, hasUnsavedDraft: false, previousIndex: 1, index: 0 })).toEqual({ kind: 'apply' });
  });

  it('applies a panel-only change even with an unsaved draft, since the contact stays open', () => {
    const withPanel: UrlState = { ...ALICE, openPanel: 'settings' };
    expect(planPopState({ target: ALICE, current: withPanel, hasUnsavedDraft: true, previousIndex: 2, index: 1 })).toEqual({ kind: 'apply' });
  });

  it('asks to confirm, and how to undo, when leaving a contact with an unsaved draft', () => {
    expect(planPopState({ target: LIST, current: ALICE, hasUnsavedDraft: true, previousIndex: 1, index: 0 })).toEqual({ kind: 'confirm', undoDelta: 1 });
    expect(planPopState({ target: BOB_ACTIVITY, current: ALICE, hasUnsavedDraft: true, previousIndex: 1, index: 2 })).toEqual({ kind: 'confirm', undoDelta: -1 });
  });

  it('reports a zero undo delta rather than one that would reload the page', () => {
    expect(planPopState({ target: LIST, current: ALICE, hasUnsavedDraft: true, previousIndex: 0, index: 0 })).toEqual({ kind: 'confirm', undoDelta: 0 });
  });
});
