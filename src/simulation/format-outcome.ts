import type { Scenario } from './scenario.ts';
import type { ScenarioOutcome } from './run-scenario.ts';

const MS_PER_SECOND = 1000;
const PREVIEW_LENGTH = 60;
const ACTION_COLUMN_WIDTH = 12;
const VERDICT_COLUMN_WIDTH = 8;
const EVENT_ARROWS = { incoming: '→ them ', deleted: '  ⌫ deleted', warning: '← warning', block: '  ⛔ blocked' } as const;

function preview(text: string): string {
  return text.length > PREVIEW_LENGTH ? `${text.slice(0, PREVIEW_LENGTH)}…` : text;
}

export function formatOutcome(scenario: Scenario, outcome: ScenarioOutcome): string {
  const lines = [`# ${scenario.name}`, ...(scenario.description ? [scenario.description] : []), '', 'Timeline'];
  for (const { atMs, kind, text } of outcome.events) {
    lines.push(`  +${(atMs / MS_PER_SECOND).toFixed(2)}s  ${EVENT_ARROWS[kind]}  ${kind === 'warning' ? text : preview(text)}`.trimEnd());
  }

  lines.push('', 'Verdicts');
  for (const row of outcome.rows.filter((entry) => entry.direction === 'them')) {
    const verdict = row.flagged === null ? 'error' : row.flagged ? 'flagged' : 'passed';
    lines.push(`  ${row.action.padEnd(ACTION_COLUMN_WIDTH)} ${verdict.padEnd(VERDICT_COLUMN_WIDTH)} ${preview(row.message)}${row.reason ? `  — ${row.category ?? ''} ${row.reason}` : ''}${row.error ? `  — ${row.error}` : ''}`);
  }

  const { strikes, warnings, deletions, blocks } = outcome.counts;
  lines.push('', `Summary: strikes ${strikes} · warnings ${warnings} · deletions ${deletions} · blocks ${blocks}`);
  return lines.join('\n');
}
