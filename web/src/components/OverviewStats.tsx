import { Button } from '@/components/ui/button';
import { STAT_TILES, tileValue, type StatKey } from '@/lib/statTiles';
import { StatTile } from './StatTile';
import { useOverviewStats } from '@/lib/useStats';

const OVERVIEW_KEYS: StatKey[] = ['monitoredCount', 'activeBlocks', 'totalFlaggedDeleted', 'totalClassifierErrors'];

const SKELETON_CHIP_COUNT = 4;

export function OverviewStats() {
  const { stats, loading, error, refresh } = useOverviewStats();

  if (loading) {
    return (
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4" aria-hidden="true">
        {Array.from({ length: SKELETON_CHIP_COUNT }, (_, i) => (
          <div key={i} className="h-32 rounded-xl border border-border bg-muted/50" />
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
        {OVERVIEW_KEYS.map((key) => (
          <StatTile key={key} def={STAT_TILES[key]} value={tileValue(stats, key)} />
        ))}
      </dl>
      {error && <p className="mt-1 text-xs text-muted-foreground">Showing last known values — {error}</p>}
    </div>
  );
}
