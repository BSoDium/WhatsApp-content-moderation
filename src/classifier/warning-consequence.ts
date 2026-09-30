// What a warning may truthfully say about blocking: 'never' when escalation is off for the contact (no consequence is stated at all), 'blocking' when this very warning comes with the block, 'countdown' otherwise.
export type BlockOutlook = 'countdown' | 'blocking' | 'never';

// Phrased as "repeat offences" rather than strikes: a small model told "N strikes remain" mixed up the count and translated the word literally (French "frappes").
export function describeConsequence(strikesRemaining: number, outlook: BlockOutlook = 'countdown'): string | null {
  if (outlook === 'never') return null;
  if (strikesRemaining <= 0 && outlook === 'blocking') return 'This was your final warning: you are now blocked.';
  if (strikesRemaining <= 0) return 'This is your final warning: you can now be blocked at any time.';
  if (strikesRemaining === 1) return 'The next repeat offence will get you blocked.';
  return `You will be blocked after ${strikesRemaining} more repeat offences.`;
}

export const NO_STRIKE_WORDING_RULE = 'Never use the word "strike" or any translation of it (French "frappe"); speak of repeat offences instead (French: "récidive").';
