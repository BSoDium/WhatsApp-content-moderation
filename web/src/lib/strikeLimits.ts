import type { Setting } from './types';

export interface StrikeLimits {
  messageThreshold: number;
  callThreshold: number;
  decayMs: number;
}

// Mirrors the defaults in src/store/settings.ts, shown until /api/settings answers.
export const DEFAULT_STRIKE_LIMITS: StrikeLimits = {
  messageThreshold: 3,
  callThreshold: 3,
  decayMs: 24 * 60 * 60 * 1000,
};

function numberSetting(settings: Setting[], key: string, fallback: number): number {
  const value = Number(settings.find((setting) => setting.key === key)?.value);
  return Number.isFinite(value) ? value : fallback;
}

export function strikeLimitsFromSettings(settings: Setting[]): StrikeLimits {
  return {
    messageThreshold: numberSetting(settings, 'STRIKE_THRESHOLD', DEFAULT_STRIKE_LIMITS.messageThreshold),
    callThreshold: numberSetting(settings, 'NUISANCE_CALL_STRIKE_THRESHOLD', DEFAULT_STRIKE_LIMITS.callThreshold),
    decayMs: numberSetting(settings, 'STRIKE_DECAY_MS', DEFAULT_STRIKE_LIMITS.decayMs),
  };
}
