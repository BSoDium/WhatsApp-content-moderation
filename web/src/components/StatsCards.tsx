import { Skeleton } from '@/components/ui/skeleton';
import { cn } from '@/lib/utils';
import { formatCategory } from '@/lib/activity';
import type { Stats } from '@/lib/types';

interface StatCard {
  label: string;
  value: number;
  warn?: boolean;
}

// Short, single-line labels — a two-column mobile grid has little room, and only
// classifier errors are flagged red: a block or a deletion is the system working
// as intended, not a failure that needs an alarm color.
function cardsFor(stats: Stats): StatCard[] {
  return [
    { label: 'Monitored', value: stats.monitoredCount },
    { label: 'Blocked', value: stats.activeBlocks },
    { label: 'Deleted', value: stats.totalFlaggedDeleted },
    { label: 'Warnings', value: stats.totalWarningsSent },
    { label: 'Errors', value: stats.totalClassifierErrors, warn: stats.totalClassifierErrors > 0 },
    { label: 'Logged', value: stats.totalLogged },
  ];
}

const SKELETON_CARD_COUNT = 6;

export function StatsCards({ stats }: { stats: Stats | null }) {
  if (!stats) {
    return (
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3" aria-hidden="true">
        {Array.from({ length: SKELETON_CARD_COUNT }, (_, i) => (
          <Skeleton key={i} className="h-[72px] rounded-xl" />
        ))}
      </div>
    );
  }

  const topCategories = stats.byCategory.slice(0, 5);
  const maxCount = topCategories[0]?.count ?? 0;

  return (
    <div className="space-y-3">
      <dl className="grid grid-cols-2 gap-3 sm:grid-cols-3">
        {cardsFor(stats).map((card) => (
          <div key={card.label} className="flex flex-col justify-between rounded-xl border border-border bg-card p-3">
            <dt className="text-xs whitespace-nowrap text-muted-foreground">{card.label}</dt>
            <dd className={cn('mt-1 text-2xl font-semibold tabular-nums', card.warn && 'text-destructive')}>{card.value}</dd>
          </div>
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
