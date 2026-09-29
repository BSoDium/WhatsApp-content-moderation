import { useEffect, useState } from 'react';

const readWidth = () => document.documentElement.clientWidth;

export function useViewportWidth(): number {
  const [width, setWidth] = useState(readWidth);

  useEffect(() => {
    const onResize = () => setWidth(readWidth());
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, []);

  return width;
}
