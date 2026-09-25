const DEFAULT_BUFFER_WINDOW_MS = Number(process.env.BUFFER_WINDOW_MS ?? 7000);

/**
 * Creates a per-contact message buffer that groups a burst of messages
 * arriving within windowMs of each other into one flush, so the pipeline
 * (docs/roadmap.md issue #7) can classify the whole burst with the other
 * messages as context instead of classifying each one in total isolation
 * (issue #6).
 *
 * windowMs defaults from BUFFER_WINDOW_MS but is a per-instance option
 * rather than a fixed module constant, so a future settings source (issue
 * #9) can hand this a live value instead of only what was in the
 * environment at process start.
 *
 * The buffer is opaque to what it carries — a message can be any payload
 * the caller wants flushed back together (see index.js, which pushes
 * { text, key, timestamp } objects, not plain strings).
 *
 * @param {(contactId: string, messages: unknown[]) => void} onFlush
 * @param {{ windowMs?: number }} [options]
 * @returns {{ push: (contactId: string, message: unknown) => void }}
 */
export function createMessageBuffer(onFlush, { windowMs = DEFAULT_BUFFER_WINDOW_MS } = {}) {
  const pending = new Map();

  function flush(contactId) {
    const entry = pending.get(contactId);
    if (!entry) return;
    pending.delete(contactId);
    onFlush(contactId, entry.messages);
  }

  function push(contactId, message) {
    const entry = pending.get(contactId) ?? { messages: [] };
    entry.messages.push(message);
    clearTimeout(entry.timer);
    entry.timer = setTimeout(() => flush(contactId), windowMs);
    pending.set(contactId, entry);
  }

  return { push };
}
