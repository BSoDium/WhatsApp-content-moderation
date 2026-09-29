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
