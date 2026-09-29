import { useId, type CSSProperties } from 'react';
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
  width: `calc(4.5rem - ${COLLAPSE} * 4.5rem)`,
  height: `calc(4.5rem - ${COLLAPSE} * 4.5rem)`,
  opacity: `calc(1 - ${COLLAPSE})`,
};
// Center of the corner icon: its inset plus half its size. The pattern is masked out around it so the two layers never overlap.
const CORNER_ICON_CENTER = '3rem';
const PATTERN_STYLE: CSSProperties = {
  opacity: `calc(1 - ${COLLAPSE})`,
  maskImage: `radial-gradient(circle at calc(100% - ${CORNER_ICON_CENTER}) ${CORNER_ICON_CENTER}, transparent 2.6rem, black 3.4rem), linear-gradient(to bottom left, black 15%, transparent 75%)`,
  maskComposite: 'intersect',
  WebkitMaskComposite: 'source-in',
};
const PATTERN_CELL_PX = 36;
const PATTERN_ICON_PX = 14;
const PATTERN_ICON_OFFSET_PX = (PATTERN_CELL_PX / 2 - PATTERN_ICON_PX) / 2;
const VALUE_STYLE: CSSProperties = { fontSize: `calc(2.25rem - ${COLLAPSE} * 0.75rem)` };
const ICON_COLOR = 'text-[color-mix(in_oklab,var(--muted-foreground)_40%,var(--card))]';
const PATTERN_COLOR = 'text-[color-mix(in_oklab,var(--muted-foreground)_16%,var(--card))]';

// Two icons per cell, the second half a cell over and down, so the repeat reads as a diagonal stagger.
function IconPattern({ icon: Icon }: { icon: StatTileDef['icon'] }) {
  const id = useId();
  const half = PATTERN_CELL_PX / 2;
  return (
    <svg className={cn('pointer-events-none absolute inset-0 size-full', PATTERN_COLOR)} style={PATTERN_STYLE} aria-hidden="true">
      <defs>
        <pattern id={id} width={PATTERN_CELL_PX} height={PATTERN_CELL_PX} patternUnits="userSpaceOnUse">
          <Icon x={PATTERN_ICON_OFFSET_PX} y={PATTERN_ICON_OFFSET_PX} width={PATTERN_ICON_PX} height={PATTERN_ICON_PX} strokeWidth={1.5} />
          <Icon x={half + PATTERN_ICON_OFFSET_PX} y={half + PATTERN_ICON_OFFSET_PX} width={PATTERN_ICON_PX} height={PATTERN_ICON_PX} strokeWidth={1.5} />
        </pattern>
      </defs>
      <rect width="100%" height="100%" fill={`url(#${id})`} />
    </svg>
  );
}

export function StatTile({ def, value }: StatTileProps) {
  const Icon = def.icon;
  const empty = value === 0;
  const warn = def.warnWhenNonZero && !empty;

  return (
    <div className={cn(CARD_LAYOUT, 'text-left')} style={CARD_STYLE}>
      <IconPattern icon={Icon} />
      <Icon className={cn('absolute top-3 right-3', ICON_COLOR)} style={ICON_STYLE} strokeWidth={0.5} aria-hidden="true" />
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
