import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import { useOverviewStats } from '@/lib/useStats';
import type { Stats } from '@/lib/types';

interface OverviewChip {
  label: string;
  value: number;
  warn?: boolean;
}

// Same field mapping as StatsCards.tsx's cardsFor, trimmed to the four metrics worth
// surfacing outside the Activity panel.
function chipsFor(stats: Stats): OverviewChip[] {
  return [
    { label: 'Monitored', value: stats.monitoredCount },
    { label: 'Blocked', value: stats.activeBlocks },
    { label: 'Deleted', value: stats.totalFlaggedDeleted },
    { label: 'Errors', value: stats.totalClassifierErrors, warn: stats.totalClassifierErrors > 0 },
  ];
}

const SKELETON_CHIP_COUNT = 4;

export function OverviewStats() {
  const { stats, loading, error, refresh } = useOverviewStats();

  if (loading) {
    return (
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4" aria-hidden="true">
        {Array.from({ length: SKELETON_CHIP_COUNT }, (_, i) => (
          <div key={i} className="h-24 rounded-xl border border-border bg-muted/50" />
        ))}
      </div>
    );
  }

  if (error && !stats) {
    return (
      <div className="flex items-center justify-between gap-2 rounded-lg border border-destructive/40 bg-destructive/10 px-3 py-2 text-xs text-destructive">
        <span className="truncate">{error}</span>
        <Button variant="outline" size="xs" onClick={refresh}>
          Retry
        </Button>
      </div>
    );
  }

  if (!stats) return null;

  return (
    <div>
      <dl className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        {chipsFor(stats).map((chip) => (
          <div
            key={chip.label}
            className="relative flex min-h-24 flex-col items-start justify-end overflow-hidden rounded-xl border border-border bg-card px-4 py-3 text-left"
          >
            <dt className="order-2 mt-2 text-sm leading-none text-muted-foreground">{chip.label}</dt>
            <dd className={cn('order-1 text-3xl leading-none font-bold tracking-tight tabular-nums sm:text-4xl', chip.warn && 'text-destructive')}>{chip.value}</dd>
          </div>
        ))}
      </dl>
      {error && <p className="mt-1 text-xs text-muted-foreground">Showing last known values — {error}</p>}
    </div>
  );
}
