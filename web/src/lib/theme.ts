const DARK_MEDIA_QUERY = '(prefers-color-scheme: dark)';

// No in-app toggle — this control page is a personal tool with one operator,
// so following the OS/browser preference (and staying live if it changes,
// e.g. an OS-level light/dark schedule) covers the real need without adding
// a settings surface for it.
export function initSystemTheme(): void {
  const media = window.matchMedia(DARK_MEDIA_QUERY);
  const apply = (isDark: boolean) => document.documentElement.classList.toggle('dark', isDark);

  apply(media.matches);
  media.addEventListener('change', (event) => apply(event.matches));
}
