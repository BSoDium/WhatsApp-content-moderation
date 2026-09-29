import type { ComponentProps } from 'react';

const DIMMED_OPACITY = 0.2;

// Follows the surrounding text color, so it reads correctly in both themes.
export function TailscaleLogo(props: ComponentProps<'svg'>) {
  return (
    <svg viewBox="0 0 23 23" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true" {...props}>
      <circle opacity={DIMMED_OPACITY} cx="3.4" cy="3.25" r="2.7" fill="currentColor" />
      <circle cx="3.4" cy="11.3" r="2.7" fill="currentColor" />
      <circle opacity={DIMMED_OPACITY} cx="3.4" cy="19.5" r="2.7" fill="currentColor" />
      <circle cx="11.5" cy="11.3" r="2.7" fill="currentColor" />
      <circle cx="11.5" cy="19.5" r="2.7" fill="currentColor" />
      <circle opacity={DIMMED_OPACITY} cx="11.5" cy="3.25" r="2.7" fill="currentColor" />
      <circle opacity={DIMMED_OPACITY} cx="19.5" cy="3.25" r="2.7" fill="currentColor" />
      <circle cx="19.5" cy="11.3" r="2.7" fill="currentColor" />
      <circle opacity={DIMMED_OPACITY} cx="19.5" cy="19.5" r="2.7" fill="currentColor" />
    </svg>
  );
}
