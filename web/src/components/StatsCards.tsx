import { STAT_TILES, tileValue, type StatKey } from '@/lib/statTiles';
import { StatTile } from './StatTile';
import { formatCategory } from '@/lib/activity';
import type { Stats } from '@/lib/types';

const CARD_KEYS: StatKey[] = ['monitoredCount', 'activeBlocks', 'totalFlaggedDeleted', 'totalWarningsSent', 'totalClassifierErrors', 'totalLogged'];

const SKELETON_CARD_COUNT = 6;

export function StatsCards({ stats }: { stats: Stats | null }) {
  if (!stats) {
    return (
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3" aria-hidden="true">
        {Array.from({ length: SKELETON_CARD_COUNT }, (_, i) => (
          <div key={i} className="h-32 rounded-xl border border-border bg-muted/50" />
        ))}
      </div>
    );
  }

  const topCategories = stats.byCategory.slice(0, 5);
  const maxCount = topCategories[0]?.count ?? 0;

  return (
    <div className="space-y-3">
      <dl className="grid grid-cols-2 gap-3 sm:grid-cols-3">
        {CARD_KEYS.map((key) => (
          <StatTile key={key} def={STAT_TILES[key]} value={tileValue(stats, key)} delta={stats.trend?.[key]} />
        ))}
      </dl>

      {topCategories.length > 0 && (
        <div className="rounded-xl border border-border bg-card p-3">
          <p className="text-xs text-muted-foreground">Most flagged categories</p>
          <ul className="mt-2 space-y-1.5">
            {topCategories.map((entry) => (
              <li key={entry.category} className="flex items-center gap-2 text-sm">
                <span className="w-32 shrink-0 truncate">{formatCategory(entry.category)}</span>
                <span className="h-1.5 flex-1 overflow-hidden rounded-full bg-muted">
                  <span className="block h-full rounded-full bg-foreground/60" style={{ width: `${maxCount ? (entry.count / maxCount) * 100 : 0}%` }} />
                </span>
                <span className="w-6 shrink-0 text-right text-xs tabular-nums text-muted-foreground">{entry.count}</span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
