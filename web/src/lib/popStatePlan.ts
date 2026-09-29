import { sameUrlState, type UrlState } from './urlState';

export type PopStatePlan =
  | { kind: 'ignore' }
  | { kind: 'apply' }
  // `undoDelta` is the `history.go` argument that returns to the entry the user left; 0 means there is nothing to undo, and calling `history.go(0)` would reload the page.
  | { kind: 'confirm'; undoDelta: number };

interface PopStateContext {
  target: UrlState;
  current: UrlState;
  hasUnsavedDraft: boolean;
  previousIndex: number;
  index: number;
}

/**
 * Decides what a back/forward navigation should do. Landing on the state
 * already shown is ignored (it echoes our own history.go undo, or a push we
 * just wrote); leaving a contact with an unsaved draft is undone and put to
 * the save/discard dialog rather than silently dropping the draft.
 */
export function planPopState({ target, current, hasUnsavedDraft, previousIndex, index }: PopStateContext): PopStatePlan {
  if (sameUrlState(target, current)) return { kind: 'ignore' };
  if (target.contactId !== current.contactId && hasUnsavedDraft) return { kind: 'confirm', undoDelta: previousIndex - index };
  return { kind: 'apply' };
}
