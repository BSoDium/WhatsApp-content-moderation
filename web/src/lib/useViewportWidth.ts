import { useEffect, useState } from 'react';

const readWidth = () => document.documentElement.clientWidth;

// At most one update per frame, however many resize events the browser fires while the window is being dragged.
export function useViewportWidth(): number {
  const [width, setWidth] = useState(readWidth);

  useEffect(() => {
    let frame = 0;
    const onResize = () => {
      if (frame) return;
      frame = requestAnimationFrame(() => {
        frame = 0;
        setWidth(readWidth());
      });
    };
    window.addEventListener('resize', onResize);
    return () => {
      cancelAnimationFrame(frame);
      window.removeEventListener('resize', onResize);
    };
  }, []);

  return width;
}
