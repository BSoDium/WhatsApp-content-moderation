// @formkit/auto-animate's package.json declares no "types" for its root
// export (only its framework subpaths, e.g. ./react, do), so this shape
// can't be imported from the package itself under this project's module
// resolution — copied from its index.d.ts, which does document it publicly.
interface AutoAnimateCoordinates {
  top: number;
  left: number;
  width: number;
  height: number;
}
type AutoAnimationPlugin = (
  el: Element,
  action: 'add' | 'remove' | 'remain',
  newCoordinates?: AutoAnimateCoordinates,
  oldCoordinates?: AutoAnimateCoordinates,
) => KeyframeEffect;

const DURATION_MS = 250;

// auto-animate only honors prefers-reduced-motion for its own built-in
// animation (config as a plain options object); passing a plugin function,
// as this does, bypasses that check entirely on its end — see its
// autoAnimate() source. Reimplemented here so a plugin doesn't quietly
// regress the reduced-motion behavior every other transition in this app
// already respects.
function prefersReducedMotion(): boolean {
  return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
}

// auto-animate's built-in add/remove animation pairs the fade with a
// scale(.98)<->scale(1) squeeze, which reads as jittery rather than clean at
// this list's row height. Supplying any plugin replaces all three of its
// actions at once (not just add/remove), so 'remain' — the reorder slide
// this list relies on to show a newly-moderated contact moving to the top —
// is reimplemented here too, matching auto-animate's own default (a plain
// translate, no scaling) rather than losing it.
export const fadeAndSlide: AutoAnimationPlugin = (el, action, newCoords, oldCoords) => {
  const duration = prefersReducedMotion() ? 0 : DURATION_MS;
  if (action === 'add') {
    return new KeyframeEffect(el, [{ opacity: 0 }, { opacity: 1 }], { duration, easing: 'ease-in' });
  }
  if (action === 'remove') {
    return new KeyframeEffect(el, [{ opacity: 1 }, { opacity: 0 }], { duration, easing: 'ease-out' });
  }
  const deltaX = oldCoords!.left - newCoords!.left;
  const deltaY = oldCoords!.top - newCoords!.top;
  return new KeyframeEffect(
    el,
    [{ transform: `translate(${deltaX}px, ${deltaY}px)` }, { transform: 'translate(0, 0)' }],
    { duration, easing: 'ease-in-out' },
  );
};
