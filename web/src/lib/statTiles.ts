import { Ban, CircleAlert, ScrollText, ShieldCheck, TriangleAlert, Trash2, type LucideIcon } from 'lucide-react';
import type { Stats } from './types';

export type StatKey = 'monitoredCount' | 'activeBlocks' | 'totalFlaggedDeleted' | 'totalWarningsSent' | 'totalClassifierErrors' | 'totalLogged';

export interface StatTileDef {
  key: StatKey;
  label: string;
  icon: LucideIcon;
  emptyText: string;
  // A rising count is a bad sign (errors) rather than the system doing its job.
  upIsBad?: boolean;
  // Only classifier errors are flagged red — a block/deletion is the system working as intended.
  warnWhenNonZero?: boolean;
}

export const STAT_TILES: Record<StatKey, StatTileDef> = {
  monitoredCount: { key: 'monitoredCount', label: 'Monitored', icon: ShieldCheck, emptyText: 'None yet' },
  activeBlocks: { key: 'activeBlocks', label: 'Blocked', icon: Ban, emptyText: 'No one is blocked' },
  totalFlaggedDeleted: { key: 'totalFlaggedDeleted', label: 'Deleted', icon: Trash2, emptyText: 'Nothing removed yet' },
  totalWarningsSent: { key: 'totalWarningsSent', label: 'Warnings', icon: TriangleAlert, emptyText: 'No warnings sent' },
  totalClassifierErrors: { key: 'totalClassifierErrors', label: 'Errors', icon: CircleAlert, emptyText: 'All clear', upIsBad: true, warnWhenNonZero: true },
  totalLogged: { key: 'totalLogged', label: 'Logged', icon: ScrollText, emptyText: 'Waiting for messages' },
};

export function tileValue(stats: Stats, key: StatKey): number {
  return stats[key];
}
