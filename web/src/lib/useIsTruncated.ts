import { useLayoutEffect, useState, type RefObject } from 'react';

const OVERFLOW_TOLERANCE_PX = 1;

// Clipped means a `[data-truncatable]` descendant overflows (line-clamp or ellipsis). Re-measured on resize, since the containing sheet is resizable.
// While `measure` is false (e.g. the content is expanded) the last result is kept, so the toggle doesn't vanish once nothing is clipped.
export function useIsTruncated(containerRef: RefObject<HTMLElement | null>, measure: boolean): boolean {
  const [truncated, setTruncated] = useState(false);

  useLayoutEffect(() => {
    const container = containerRef.current;
    if (!container || !measure) return;

    function check() {
      const clipped = [...container!.querySelectorAll<HTMLElement>('[data-truncatable]')].some(
        (element) => element.scrollHeight - element.clientHeight > OVERFLOW_TOLERANCE_PX || element.scrollWidth - element.clientWidth > OVERFLOW_TOLERANCE_PX,
      );
      setTruncated(clipped);
    }

    check();
    const observer = new ResizeObserver(check);
    observer.observe(container);
    return () => observer.disconnect();
  }, [containerRef, measure]);

  return truncated;
}
