import { useState } from 'react';
import { AnimatePresence, motion, useReducedMotion } from 'motion/react';
import { Ban } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';

// Material 3's "emphasized decelerate" curve, as in BannerReveal.
const EASE: [number, number, number, number] = [0.19, 0, 0, 1];
const DURATION_S = 0.3;
const ROW_GAP_PX = 6;
const COLLAPSED_SCALE = 0.6;

interface UnblockButtonProps {
  visible: boolean;
  contactName: string;
  onUnblock: () => Promise<void>;
}

/**
 * Solid red unblock action that grows into the row's button group when the
 * contact becomes blocked and folds away again once they are unblocked. The
 * negative margin cancels the group's flex gap while the width is still zero.
 * Clipping applies only during the motion so the focus ring isn't cut off at
 * rest.
 */
export function UnblockButton({ visible, contactName, onUnblock }: UnblockButtonProps) {
  const reduceMotion = useReducedMotion();
  const [pending, setPending] = useState(false);
  const transition = { duration: reduceMotion ? 0 : DURATION_S, ease: EASE };
  const label = `Unblock ${contactName}`;

  async function handleClick(event: React.MouseEvent<HTMLButtonElement>): Promise<void> {
    event.stopPropagation();
    setPending(true);
    try {
      await onUnblock();
    } finally {
      setPending(false);
    }
  }

  return (
    <AnimatePresence initial={false}>
      {visible && (
        <motion.div
          key="unblock"
          initial={{ width: 0, marginRight: -ROW_GAP_PX, opacity: 0, scale: COLLAPSED_SCALE, overflow: 'hidden' }}
          animate={{ width: 'auto', marginRight: 0, opacity: 1, scale: 1, transitionEnd: { overflow: 'visible' }, transition }}
          exit={{ width: 0, marginRight: -ROW_GAP_PX, opacity: 0, scale: COLLAPSED_SCALE, overflow: 'hidden', transition }}
          className="flex"
        >
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                size="icon-lg"
                className="bg-destructive text-white hover:bg-destructive/90 focus-visible:ring-destructive/40"
                aria-label={label}
                disabled={pending}
                onClick={handleClick}
              >
                <Ban />
              </Button>
            </TooltipTrigger>
            <TooltipContent>Unblock</TooltipContent>
          </Tooltip>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
