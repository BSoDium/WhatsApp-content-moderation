import { useState } from 'react';

// True when the panes are heading to a new open/close state, false when only the viewport changed. Kept in state (adjusted during render) rather than a ref, so it survives discarded renders and stays put across unrelated re-renders.
export function useAnimatePanes(panelOpen: boolean, viewportWidth: number): boolean {
  const [previous, setPrevious] = useState({ panelOpen, viewportWidth });
  const [animate, setAnimate] = useState(false);

  if (previous.panelOpen !== panelOpen || previous.viewportWidth !== viewportWidth) {
    setPrevious({ panelOpen, viewportWidth });
    setAnimate(previous.panelOpen !== panelOpen);
  }

  return animate;
}
