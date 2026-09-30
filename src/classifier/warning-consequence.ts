// Phrased as "repeat offences" rather than strikes: a small model told "N strikes remain" mixed up the count and translated the word literally (French "frappes").
// `blockFollows` is true only when this warning accompanies the strike that triggers a block, so the text may say the block is happening rather than merely possible.
export function describeConsequence(strikesRemaining: number, blockFollows = false): string {
  if (strikesRemaining <= 0 && blockFollows) return 'This was your final warning: you are now blocked.';
  if (strikesRemaining <= 0) return 'This is your final warning: you can now be blocked at any time.';
  if (strikesRemaining === 1) return 'The next repeat offence will get you blocked.';
  return `You will be blocked after ${strikesRemaining} more repeat offences.`;
}

export const NO_STRIKE_WORDING_RULE = 'Never use the word "strike" or any translation of it (French "frappe"); speak of repeat offences instead (French: "récidive").';
