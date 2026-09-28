import { Check, Minus, TrendingDown, TrendingUp } from 'lucide-react';
import { cn } from '@/lib/utils';
import type { StatTileDef } from '@/lib/statTiles';

interface StatTileProps {
  def: StatTileDef;
  value: number;
  // Change over the trend window; undefined when the server doesn't report one.
  delta?: number;
}

const TREND_WINDOW_LABEL = 'this week';

function TrendLine({ delta, judged }: { delta: number; judged: boolean }) {
  if (delta === 0) {
    return (
      <span className="flex items-center gap-1 text-muted-foreground">
        <Minus className="size-3.5" aria-hidden="true" />
        No change {TREND_WINDOW_LABEL}
      </span>
    );
  }
  const rising = delta > 0;
  // Only a judged metric (errors) colors its direction; for the rest, more or fewer isn't good or bad news.
  const Icon = rising ? TrendingUp : TrendingDown;
  return (
    <span className={cn('flex items-center gap-1 font-medium', !judged && 'text-muted-foreground', judged && rising && 'text-destructive', judged && !rising && 'text-emerald-600 dark:text-emerald-400')}>
      <Icon className="size-3.5" aria-hidden="true" />
      {rising ? '+' : '−'}
      {Math.abs(delta)} {TREND_WINDOW_LABEL}
    </span>
  );
}

export function StatTile({ def, value, delta }: StatTileProps) {
  const Icon = def.icon;
  const empty = value === 0;
  const warn = def.warnWhenNonZero && !empty;

  return (
    <div className="relative flex min-h-32 flex-col justify-end overflow-hidden rounded-xl border border-border bg-card px-4 py-3 text-left">
      <Icon className="absolute top-3 right-3 size-6 text-muted-foreground/40" strokeWidth={2.5} aria-hidden="true" />
      <dd className={cn('order-1 text-4xl leading-none font-bold tracking-tight tabular-nums', empty && 'text-muted-foreground/40', warn && 'text-destructive')}>{value}</dd>
      <dt className="order-2 mt-2 text-sm leading-none font-medium text-muted-foreground">{def.label}</dt>
      <dd className="order-3 mt-2 min-h-4 text-xs leading-tight text-muted-foreground">
        {empty ? (
          <span className="flex items-center gap-1">
            {def.upIsBad && <Check className="size-3.5 text-emerald-600 dark:text-emerald-400" aria-hidden="true" />}
            {def.emptyText}
          </span>
        ) : delta !== undefined ? (
          <TrendLine delta={delta} judged={def.upIsBad ?? false} />
        ) : null}
      </dd>
    </div>
  );
}
