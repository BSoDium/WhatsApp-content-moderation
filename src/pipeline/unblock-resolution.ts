import { markUnblocked } from '../store/blocks.ts';
import { emitControlEvent } from '../store/events.ts';

export type UnblockOutcome =
  | { status: 'unblocked' }
  | { status: 'already-resolved' }
  | { status: 'failed'; error: string };

/**
 * Shared by unblock-scheduler.ts's automatic tick and manual-override.ts's
 * manual 'unblock' command: calls unblock(contactId), then marks the local
 * block record resolved — never the reverse order, since an unconfirmed
 * unblock must never be recorded as done (see unblock-scheduler.ts's own
 * JSDoc). Callers are expected to have already confirmed blockId refers to
 * a currently-active block; this only resolves it.
 */
export async function resolveUnblock(contactId: string, blockId: number, unblock: (contactId: string) => Promise<void>): Promise<UnblockOutcome> {
  try {
    await unblock(contactId);
  } catch (err) {
    return { status: 'failed', error: err instanceof Error ? err.message : String(err) };
  }

  if (!markUnblocked(blockId)) return { status: 'already-resolved' };

  emitControlEvent('roster');
  return { status: 'unblocked' };
}
