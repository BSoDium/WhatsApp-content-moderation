import { useEffect, type RefObject } from 'react';

// Runs `apply` on the scroller at most once per frame, so it can write CSS custom properties straight to the DOM. That keeps scroll-linked visuals out of React state: nothing re-renders while scrolling.
export function useScrollLinkedStyle(scrollerRef: RefObject<HTMLElement | null>, enabled: boolean, apply: (scroller: HTMLElement) => void): void {
  useEffect(() => {
    const scroller = scrollerRef.current;
    if (!scroller || !enabled) return;

    let frame = 0;
    function schedule() {
      if (frame) return;
      frame = requestAnimationFrame(() => {
        frame = 0;
        apply(scroller!);
      });
    }

    apply(scroller);
    scroller.addEventListener('scroll', schedule, { passive: true });
    window.addEventListener('resize', schedule);
    return () => {
      cancelAnimationFrame(frame);
      scroller.removeEventListener('scroll', schedule);
      window.removeEventListener('resize', schedule);
    };
  }, [scrollerRef, enabled, apply]);
}

export function clamp01(value: number): number {
  return Math.min(1, Math.max(0, value));
}
