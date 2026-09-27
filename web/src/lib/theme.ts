const DARK_MEDIA_QUERY = '(prefers-color-scheme: dark)';

// No in-app toggle: a single-operator tool just follows the OS/browser preference live, with no settings surface for it.
export function initSystemTheme(): void {
  const media = window.matchMedia(DARK_MEDIA_QUERY);
  const apply = (isDark: boolean) => document.documentElement.classList.toggle('dark', isDark);

  apply(media.matches);
  media.addEventListener('change', (event) => apply(event.matches));
}
