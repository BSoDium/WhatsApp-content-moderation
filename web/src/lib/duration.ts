const SECOND_MS = 1000;
const UNITS: Array<[string, number]> = [
  ['d', 24 * 60 * 60 * SECOND_MS],
  ['h', 60 * 60 * SECOND_MS],
  ['m', 60 * SECOND_MS],
  ['s', SECOND_MS],
];

// Two most significant units at most ("3d 4h", "12m 5s"), so it stays short enough for a table cell.
export function formatElapsed(ms: number): string {
  let remaining = Math.max(0, ms);
  const parts: string[] = [];
  for (const [unit, size] of UNITS) {
    const count = Math.floor(remaining / size);
    remaining -= count * size;
    if (count > 0 || (parts.length > 0 && unit !== 's')) parts.push(`${count}${unit}`);
    if (parts.length === 2) break;
  }
  return parts.length > 0 ? parts.join(' ') : '0s';
}

const LONG_UNITS: Array<[string, number]> = [
  ['day', 24 * 60 * 60 * SECOND_MS],
  ['hour', 60 * 60 * SECOND_MS],
  ['minute', 60 * SECOND_MS],
];

// The largest unit that divides the value evenly ("24 hours", "5 minutes"), falling back to whole minutes, for prose rather than table cells.
export function formatDuration(ms: number): string {
  const [unit, size] = LONG_UNITS.find(([, unitMs]) => ms >= unitMs && ms % unitMs === 0) ?? ['minute', LONG_UNITS[2][1]];
  const count = Math.max(1, Math.round(ms / size));
  return `${count} ${unit}${count === 1 ? '' : 's'}`;
}
