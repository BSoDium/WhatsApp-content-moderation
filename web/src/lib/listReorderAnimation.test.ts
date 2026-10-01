import { afterEach, expect, test, vi } from 'vitest';
import { fadeAndSlide } from './listReorderAnimation';

afterEach(() => vi.unstubAllGlobals());

test('a reorder slides rows vertically even when their cached left edge is stale', () => {
  const keyframeEffect = vi.fn();
  vi.stubGlobal('KeyframeEffect', keyframeEffect);
  vi.stubGlobal('matchMedia', () => ({ matches: false }));

  const el = document.createElement('li');
  const oldCoords = { top: 200, left: 640, width: 400, height: 56 };
  const newCoords = { top: 100, left: 32, width: 400, height: 56 };
  fadeAndSlide(el, 'remain', oldCoords, newCoords);

  const [, keyframes] = keyframeEffect.mock.calls[0];
  expect(keyframes).toEqual([{ transform: 'translateY(100px)' }, { transform: 'translateY(0)' }]);
});
