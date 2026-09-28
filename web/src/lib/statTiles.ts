import { Ban, CircleAlert, ScrollText, ShieldCheck, TriangleAlert, Trash2, type LucideIcon } from 'lucide-react';
import type { Stats } from './types';

export type StatKey = 'monitoredCount' | 'activeBlocks' | 'totalFlaggedDeleted' | 'totalWarningsSent' | 'totalClassifierErrors' | 'totalLogged';

export interface StatTileDef {
  key: StatKey;
  label: string;
  icon: LucideIcon;
  // Only classifier errors are flagged red — a block/deletion is the system working as intended.
  warnWhenNonZero?: boolean;
}

export const STAT_TILES: Record<StatKey, StatTileDef> = {
  monitoredCount: { key: 'monitoredCount', label: 'Monitored', icon: ShieldCheck },
  activeBlocks: { key: 'activeBlocks', label: 'Blocked', icon: Ban },
  totalFlaggedDeleted: { key: 'totalFlaggedDeleted', label: 'Deleted', icon: Trash2 },
  totalWarningsSent: { key: 'totalWarningsSent', label: 'Warnings', icon: TriangleAlert },
  totalClassifierErrors: { key: 'totalClassifierErrors', label: 'Errors', icon: CircleAlert, warnWhenNonZero: true },
  totalLogged: { key: 'totalLogged', label: 'Logged', icon: ScrollText },
};

export function tileValue(stats: Stats, key: StatKey): number {
  return stats[key];
}
