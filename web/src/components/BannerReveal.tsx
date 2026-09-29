import type { ReactNode } from 'react';
import { motion, useReducedMotion } from 'motion/react';

// Material 3's "emphasized decelerate" curve.
const EASE: [number, number, number, number] = [0.19, 0, 0, 1];
const SPACE_MS = 0.5;
// The emphasized curve has opened nearly all of the height by this point (~96% at 350ms), so content fading in never sits under the clip.
const ENTER_FADE_DELAY_S = 0.35;
const ENTER_FADE_S = 0.4;
const EXIT_FADE_S = 0.2;
const EXIT_COLLAPSE_DELAY_S = 0.1;

interface BannerRevealProps {
  children: ReactNode;
  // False for content present with the first data: it is part of the settled layout, not an event.
  animate?: boolean;
}

/**
 * Reveals a banner by opening its space first and fading the content in once
 * there is room for it, and the reverse on exit (fade, then collapse). Fading
 * and growing at the same time clips the content while the height catches up.
 * Must be a direct, keyed child of `AnimatePresence`.
 */
export function BannerReveal({ children, animate = true }: BannerRevealProps) {
  const reduceMotion = useReducedMotion();
  const instant = reduceMotion || !animate;
  const space = instant ? { duration: 0 } : { duration: SPACE_MS, ease: EASE };

  return (
    <motion.div
      initial={{ height: 0, marginTop: 0, opacity: 0 }}
      animate={{
        height: 'auto',
        marginTop: '1rem',
        opacity: 1,
        transition: { height: space, marginTop: space, opacity: instant ? { duration: 0 } : { delay: ENTER_FADE_DELAY_S, duration: ENTER_FADE_S, ease: EASE } },
      }}
      exit={{
        height: 0,
        marginTop: 0,
        opacity: 0,
        transition: {
          height: instant ? { duration: 0 } : { delay: EXIT_COLLAPSE_DELAY_S, duration: SPACE_MS, ease: EASE },
          marginTop: instant ? { duration: 0 } : { delay: EXIT_COLLAPSE_DELAY_S, duration: SPACE_MS, ease: EASE },
          opacity: instant ? { duration: 0 } : { duration: EXIT_FADE_S, ease: EASE },
        },
      }}
      className="overflow-hidden"
    >
      {children}
    </motion.div>
  );
}
