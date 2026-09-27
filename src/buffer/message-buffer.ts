import { getNumberSetting } from '../store/settings.ts';

const DEFAULT_WINDOW_MS = () => getNumberSetting('BUFFER_WINDOW_MS');

/**
 * Creates a per-contact message buffer that groups a burst of messages
 * arriving within windowMs of each other into one flush, so the pipeline
 * (docs/roadmap.md issue #7) can classify the whole burst with the other
 * messages as context instead of classifying each one in total isolation
 * (issue #6).
 *
 * windowMs defaults to a live read of the BUFFER_WINDOW_MS setting, resolved
 * fresh on every push — not once at construction — so an edit made via the
 * control app's settings panel changes the *next* debounce window without a
 * restart. Also accepts a plain number (tests do), used as-is.
 *
 * The buffer is opaque to what it carries — a message can be any payload
 * the caller wants flushed back together (see index.ts, which pushes
 * { text, key, timestamp } objects, not plain strings).
 *
 * @param {(contactId: string, messages: unknown[]) => void} onFlush
 * @param {{ windowMs?: number | (() => number) }} [options]
 * @returns {{
 *   push: (contactId: string, message: unknown) => void,
 *   flushAll: () => Promise<unknown>,
 * }}
 */
export function createMessageBuffer<T = unknown>(
  onFlush: (contactId: string, messages: T[]) => void | Promise<unknown>,
  { windowMs = DEFAULT_WINDOW_MS }: { windowMs?: number | (() => number) } = {},
) {
  const pending = new Map<string, { messages: T[]; timer?: ReturnType<typeof setTimeout> }>();

  function resolveWindowMs(): number {
    return typeof windowMs === 'function' ? windowMs() : windowMs;
  }

  function flush(contactId: string) {
    const entry = pending.get(contactId);
    if (!entry) return undefined;
    pending.delete(contactId);
    clearTimeout(entry.timer);
    return onFlush(contactId, entry.messages);
  }

  function push(contactId: string, message: T) {
    const entry = pending.get(contactId) ?? { messages: [] };
    entry.messages.push(message);
    clearTimeout(entry.timer);
    entry.timer = setTimeout(() => flush(contactId), resolveWindowMs());
    pending.set(contactId, entry);
  }

  // Flushes every contact's pending window immediately, so shutdown (see index.ts) doesn't silently drop unflushed messages.
  function flushAll() {
    return Promise.allSettled(Array.from(pending.keys(), flush));
  }

  return { push, flushAll };
}
