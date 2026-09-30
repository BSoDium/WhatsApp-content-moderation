export interface DecayableStrikes {
  count: number;
  updatedAt: number;
}

/**
 * Applies time-based decay to a strike counter: one strike is forgiven for
 * every full `decayMs` since `updatedAt`, floored at zero. `updatedAt` moves
 * forward by the whole periods consumed, so a partly elapsed period is kept
 * rather than restarted. A `decayMs` of 0 disables decay.
 */
export function settleStrikes({ count, updatedAt }: DecayableStrikes, now: number, decayMs: number): DecayableStrikes {
  if (decayMs <= 0 || count <= 0) return { count, updatedAt };
  const periods = Math.floor((now - updatedAt) / decayMs);
  if (periods <= 0) return { count, updatedAt };
  return { count: Math.max(count - periods, 0), updatedAt: updatedAt + periods * decayMs };
}
