import { Check, Minus, TrendingDown, TrendingUp } from 'lucide-react';
import { cn } from '@/lib/utils';
import type { StatTileDef } from '@/lib/statTiles';

interface StatTileProps {
  def: StatTileDef;
  value: number;
  delta?: number;
}

const TREND_WINDOW_LABEL = 'this week';
const ICON_COLOR = 'text-[color-mix(in_oklab,var(--muted-foreground)_40%,var(--card))]';

function TrendLine({ delta, judged }: { delta: number; judged: boolean }) {
  if (delta === 0) {
    return (
      <span className="flex items-center gap-1">
        <Minus className="size-3.5" aria-hidden="true" />
        No change
      </span>
    );
  }
  const rising = delta > 0;
  const Icon = rising ? TrendingUp : TrendingDown;
  return (
    <span className={cn('flex items-center gap-1', judged && rising && 'text-destructive', judged && !rising && 'text-emerald-600 dark:text-emerald-400')}>
      <Icon className="size-3.5" aria-hidden="true" />
      {rising ? '+' : '−'}
      {Math.abs(delta)} {TREND_WINDOW_LABEL}
    </span>
  );
}

function Extra({ def, value, delta }: StatTileProps) {
  if (value === 0) {
    if (!def.allClearText) return null;
    return (
      <span className="flex items-center gap-1 text-emerald-600 dark:text-emerald-400">
        <Check className="size-3.5" aria-hidden="true" />
        {def.allClearText}
      </span>
    );
  }
  if (delta === undefined) return null;
  return <TrendLine delta={delta} judged={def.upIsBad ?? false} />;
}

export function StatTile({ def, value, delta }: StatTileProps) {
  const Icon = def.icon;
  const empty = value === 0;
  const warn = def.warnWhenNonZero && !empty;

  return (
    <div className="relative flex min-h-32 flex-col items-start justify-end overflow-hidden rounded-xl border border-border bg-card px-4 py-3 text-left">
      <Icon className={cn('absolute top-3 right-3 size-6', ICON_COLOR)} strokeWidth={2.5} aria-hidden="true" />
      <dd className={cn('order-1 text-4xl leading-none font-bold tracking-tight tabular-nums', empty && 'text-muted-foreground/40', warn && 'text-destructive')}>{value}</dd>
      <dt className="order-2 mt-2 flex w-full flex-wrap items-baseline justify-between gap-x-2 gap-y-1 text-sm leading-tight font-medium text-muted-foreground">
        <span>{def.label}</span>
        <span className="text-xs font-normal">
          <Extra def={def} value={value} delta={delta} />
        </span>
      </dt>
    </div>
  );
}
