const DARK_MEDIA_QUERY = '(prefers-color-scheme: dark)';

// Every themed element transitions its own colors independently (border,
// background, icon fill, …), so a live scheme change makes them visibly
// cascade one after another — a button flickering, a divider fading a beat
// behind everything else — rather than flipping together the way switching
// themes reads everywhere else. Suppressing transitions for one frame
// around the class toggle makes it instant instead of staggered.
function toggleDarkWithoutTransitions(root: HTMLElement, isDark: boolean): void {
  root.classList.add('theme-transition-off');
  root.classList.toggle('dark', isDark);
  // Two rAFs: the first lets the transition-off style commit before the
  // class toggle paints; the second runs only after that paint, so removing
  // the guard can't race the toggle it's meant to cover.
  requestAnimationFrame(() => {
    requestAnimationFrame(() => root.classList.remove('theme-transition-off'));
  });
}

// No in-app toggle: a single-operator tool just follows the OS/browser preference live, with no settings surface for it.
export function initSystemTheme(): void {
  const media = window.matchMedia(DARK_MEDIA_QUERY);
  const root = document.documentElement;

  root.classList.toggle('dark', media.matches); // first paint — no guard needed, nothing has rendered yet to flicker
  media.addEventListener('change', (event) => toggleDarkWithoutTransitions(root, event.matches));
}
