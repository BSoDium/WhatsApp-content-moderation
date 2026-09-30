import { createRandom, hashSeed } from './random';

const SKIN_TONES = ['#f6d5b8', '#eabf98', '#d9a174', '#b77a4f', '#8a5536', '#5d3a25'];
const HAIR_COLORS = ['#1f1a17', '#3b2a20', '#6b4423', '#a66a2c', '#d8b26a', '#b8b8b8', '#8c2f2f'];
const BACKGROUNDS = ['#cfe8e6', '#fbe0c8', '#e0d6f2', '#cfe3f0', '#f3d1df', '#d5ebd9', '#f2e3bd', '#d6daf2'];
const SHIRTS = ['#1d7874', '#c65102', '#5b3a9e', '#0f6e94', '#a8325e', '#2f7a3f', '#8a5a00', '#3f51b5', '#37474f'];

const HAIR_STYLES = [
  (hair: string) => `<path d="M30 44c0-16 10-26 20-26s20 10 20 26c-6-8-12-11-20-11s-14 3-20 11z" fill="${hair}"/>`,
  (hair: string) => `<path d="M28 52c-2-22 8-34 22-34s24 12 22 34c-2-10-4-16-6-18-6 4-24 4-32 0-2 2-4 8-6 18z" fill="${hair}"/>`,
  (hair: string) => `<path d="M29 66c-4-24 4-48 21-48s25 24 21 48c-1-14-3-24-6-30-8 4-22 4-30 0-3 6-5 16-6 30z" fill="${hair}"/>`,
  (hair: string) => `<circle cx="50" cy="26" r="15" fill="${hair}"/><path d="M32 42c2-12 10-18 18-18s16 6 18 18c-6-6-12-8-18-8s-12 2-18 8z" fill="${hair}"/>`,
  () => '',
];

export function avatarDataUri(seed: string): string {
  const random = createRandom(hashSeed(seed));
  const skin = random.pick(SKIN_TONES);
  const hair = random.pick(HAIR_COLORS);
  const hairStyle = random.pick(HAIR_STYLES);
  const glasses = random.chance(0.3);
  const smile = random.int(0, 1) === 0 ? 'M42 62q8 7 16 0' : 'M43 62q7 4 14 0';
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100">
<rect width="100" height="100" fill="${random.pick(BACKGROUNDS)}"/>
<path d="M14 100c2-20 16-28 36-28s34 8 36 28z" fill="${random.pick(SHIRTS)}"/>
<rect x="43" y="62" width="14" height="14" rx="5" fill="${skin}"/>
<ellipse cx="50" cy="46" rx="19" ry="22" fill="${skin}"/>
${hairStyle(hair)}
<circle cx="42" cy="47" r="2.2" fill="#2b211c"/><circle cx="58" cy="47" r="2.2" fill="#2b211c"/>
${glasses ? '<g fill="none" stroke="#2b211c" stroke-width="1.6"><circle cx="42" cy="47" r="6.5"/><circle cx="58" cy="47" r="6.5"/><path d="M48.5 47h3"/></g>' : ''}
<path d="${smile}" fill="none" stroke="#7a3b2e" stroke-width="2" stroke-linecap="round"/>
</svg>`;
  return `data:image/svg+xml;utf8,${encodeURIComponent(svg)}`;
}
