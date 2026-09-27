import { EventEmitter } from 'node:events';

export type ControlEventTopic = 'contacts' | 'roster' | 'audit-log' | 'settings' | 'policy';

const emitter = new EventEmitter();
// One control server can hold many concurrent SSE connections (browser tabs) — all
// listening to the same topics, not a leak.
emitter.setMaxListeners(0);

export function emitControlEvent(topic: ControlEventTopic): void {
  emitter.emit('event', topic);
}

/**
 * Subscribes to every control-data change (a contact learned/renamed, the
 * roster changing, a new audit-log entry) so a caller — the control
 * server's SSE endpoint — can push a "something changed, go refetch" signal
 * to connected browser tabs instead of them polling on a fixed interval.
 *
 * @returns {() => void} unsubscribe
 */
export function onControlEvent(listener: (topic: ControlEventTopic) => void): () => void {
  emitter.on('event', listener);
  return () => emitter.off('event', listener);
}
