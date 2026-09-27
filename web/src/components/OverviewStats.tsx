import { Skeleton } from '@/components/ui/skeleton';
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
      <div className="grid grid-cols-4 gap-2" aria-hidden="true">
        {Array.from({ length: SKELETON_CHIP_COUNT }, (_, i) => (
          <Skeleton key={i} className="h-[42px] rounded-lg" />
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
      <dl className="grid grid-cols-4 gap-2">
        {chipsFor(stats).map((chip) => (
          <div
            key={chip.label}
            className="flex flex-col items-center justify-center gap-0.5 rounded-lg border border-border bg-card px-1 py-1.5"
          >
            <dt className="text-[10px] leading-none whitespace-nowrap text-muted-foreground">{chip.label}</dt>
            <dd className={cn('text-sm leading-none font-semibold tabular-nums', chip.warn && 'text-destructive')}>{chip.value}</dd>
          </div>
        ))}
      </dl>
      {error && <p className="mt-1 text-[10px] text-muted-foreground">Showing last known values — {error}</p>}
    </div>
  );
}
