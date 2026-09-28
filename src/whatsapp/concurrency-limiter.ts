/**
 * Caps how many tasks run at once; callers past the cap wait, FIFO, for a
 * free slot. A finishing task hands its slot straight to the next waiter
 * instead of freeing it, so a caller arriving in between can never overtake
 * the queue and push the active count past `maxConcurrent`.
 */
export function createConcurrencyLimiter(maxConcurrent: number) {
  let active = 0;
  const waiting: Array<() => void> = [];

  function release(): void {
    const next = waiting.shift();
    if (next) next();
    else active--;
  }

  async function run<T>(task: () => Promise<T>): Promise<T> {
    if (active < maxConcurrent) active++;
    else await new Promise<void>((resolve) => waiting.push(resolve));
    try {
      return await task();
    } finally {
      release();
    }
  }

  return { run };
}
