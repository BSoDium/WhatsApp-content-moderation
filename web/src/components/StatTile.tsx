import type { CSSProperties } from 'react';
import { cn } from '@/lib/utils';
import { Skeleton } from '@/components/ui/skeleton';
import type { StatTileDef } from '@/lib/statTiles';

interface StatTileProps {
  def: StatTileDef;
  value: number;
}

// `--collapse` (0 expanded, 1 collapsed) is written by the list pane's scroll handler on mobile; unset elsewhere, so tiles stay fully expanded.
const COLLAPSE = 'var(--collapse, 0)';

const CARD_LAYOUT = 'relative flex flex-col items-start justify-end overflow-hidden rounded-xl border border-border bg-card';
const CARD_STYLE: CSSProperties = {
  minHeight: `calc(8rem - ${COLLAPSE} * 4.75rem)`,
  padding: `calc(0.75rem - ${COLLAPSE} * 0.375rem) 1rem`,
};
const ICON_STYLE: CSSProperties = {
  width: `calc(5.5rem - ${COLLAPSE} * 5.5rem)`,
  height: `calc(5.5rem - ${COLLAPSE} * 5.5rem)`,
  opacity: `calc(1 - ${COLLAPSE})`,
};
const VALUE_STYLE: CSSProperties = { fontSize: `calc(2.25rem - ${COLLAPSE} * 0.75rem)` };
const ICON_COLOR = 'text-[color-mix(in_oklab,var(--muted-foreground)_40%,var(--card))]';

export function StatTile({ def, value }: StatTileProps) {
  const Icon = def.icon;
  const empty = value === 0;
  const warn = def.warnWhenNonZero && !empty;

  return (
    <div className={cn(CARD_LAYOUT, 'text-left')} style={CARD_STYLE}>
      <Icon className={cn('absolute -top-1 -right-1', ICON_COLOR)} style={ICON_STYLE} strokeWidth={0.5} aria-hidden="true" />
      <dd className={cn('order-1 leading-none font-bold tracking-tight tabular-nums', empty && 'text-muted-foreground/40', warn && 'text-destructive')} style={VALUE_STYLE}>
        {value}
      </dd>
      <dt className="order-2 mt-1 text-sm leading-tight font-medium text-muted-foreground">{def.label}</dt>
    </div>
  );
}

export function StatTileSkeleton() {
  return (
    <div className={CARD_LAYOUT} style={CARD_STYLE} aria-hidden="true">
      <Skeleton className="absolute top-3 right-3 size-12" />
      <Skeleton className="h-9 w-14" />
      <Skeleton className="mt-2 h-4 w-20" />
    </div>
  );
}
