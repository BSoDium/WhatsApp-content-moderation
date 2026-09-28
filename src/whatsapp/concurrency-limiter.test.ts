import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createConcurrencyLimiter } from './concurrency-limiter.ts';

function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

const tick = () => new Promise((resolve) => setImmediate(resolve));

test('never runs more than maxConcurrent tasks at once, and still runs every task', async () => {
  const limiter = createConcurrencyLimiter(2);
  let active = 0;
  let maxActive = 0;
  const gates = Array.from({ length: 6 }, () => deferred());

  const runs = gates.map((gate, i) =>
    limiter.run(async () => {
      active++;
      maxActive = Math.max(maxActive, active);
      await gate.promise;
      active--;
      return i;
    }),
  );

  await tick();
  assert.equal(active, 2);
  for (const gate of gates) {
    gate.resolve();
    await tick();
    assert.ok(active <= 2);
  }

  assert.deepEqual(await Promise.all(runs), [0, 1, 2, 3, 4, 5]);
  assert.equal(maxActive, 2);
});

test('waiters start in FIFO order', async () => {
  const limiter = createConcurrencyLimiter(1);
  const started = [];
  const first = deferred();

  const runs = [
    limiter.run(async () => {
      started.push('a');
      await first.promise;
    }),
    limiter.run(async () => started.push('b')),
    limiter.run(async () => started.push('c')),
  ];
  await tick();
  first.resolve();
  await Promise.all(runs);

  assert.deepEqual(started, ['a', 'b', 'c']);
});

test('a rejected task still frees its slot and propagates its error', async () => {
  const limiter = createConcurrencyLimiter(1);

  await assert.rejects(limiter.run(async () => { throw new Error('boom'); }), /boom/);
  assert.equal(await limiter.run(async () => 'next'), 'next');
});

test('a caller arriving right as a slot is handed off cannot overtake the queue', async () => {
  const limiter = createConcurrencyLimiter(1);
  let active = 0;
  let maxActive = 0;
  const task = async () => {
    active++;
    maxActive = Math.max(maxActive, active);
    await tick();
    active--;
  };

  const first = limiter.run(task);
  const queued = limiter.run(task);
  // Arrives synchronously after the first task settles, before the queued
  // waiter's microtask has resumed it.
  const late = first.then(() => limiter.run(task));
  await Promise.all([first, queued, late]);

  assert.equal(maxActive, 1);
});
