import { describeConsequence } from '../classifier/warning-consequence.ts';
import type { classifyMessage } from '../classifier/classifier.ts';
import type { generateWarningMessage } from '../classifier/warning-message.ts';

const STUB_CATEGORY = 'stub';

export function keywordClassifier(flagWords: string[]): typeof classifyMessage {
  const lowered = flagWords.map((word) => word.toLowerCase());
  return async ({ message }) => {
    const hit = lowered.find((word) => message.toLowerCase().includes(word));
    return { ok: true, flagged: hit !== undefined, category: hit ? STUB_CATEGORY : 'none', reason: hit ? `contains "${hit}"` : 'no flag word' };
  };
}

export const stubWarning: typeof generateWarningMessage = async ({ strikeCount, strikeThreshold }) => ({
  ok: true,
  text: `[stub warning] ${describeConsequence(strikeThreshold - strikeCount)}`,
});
