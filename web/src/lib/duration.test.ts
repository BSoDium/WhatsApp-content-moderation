import { expect, test } from 'vitest';
import { formatDuration, formatElapsed } from './duration';

test('formats the two most significant units', () => {
  expect(formatElapsed(45_000)).toBe('45s');
  expect(formatElapsed(12 * 60_000 + 5_000)).toBe('12m 5s');
  expect(formatElapsed(3 * 3600_000 + 7 * 60_000)).toBe('3h 7m');
  expect(formatElapsed(3 * 86_400_000 + 4 * 3600_000 + 9 * 60_000)).toBe('3d 4h');
});

test('clamps negatives and zero to 0s', () => {
  expect(formatElapsed(0)).toBe('0s');
  expect(formatElapsed(-500)).toBe('0s');
});

test('keeps a zero middle unit so the two parts stay adjacent', () => {
  expect(formatElapsed(2 * 3600_000 + 30_000)).toBe('2h 0m');
});

test('formatDuration picks the largest unit that divides evenly', () => {
  expect(formatDuration(24 * 3600_000)).toBe('1 day');
  expect(formatDuration(48 * 3600_000)).toBe('2 days');
  expect(formatDuration(36 * 3600_000)).toBe('36 hours');
  expect(formatDuration(5 * 60_000)).toBe('5 minutes');
  expect(formatDuration(60_000)).toBe('1 minute');
});

test('formatDuration rounds an uneven value to whole minutes', () => {
  expect(formatDuration(90_000)).toBe('2 minutes');
  expect(formatDuration(5_000)).toBe('1 minute');
});
