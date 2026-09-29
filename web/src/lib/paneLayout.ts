// The list column's content is at most this wide; the pane adds the same 2rem of side padding (`lg:px-8`) each side, which is also the least margin the content keeps on narrow desktops.
export const CONTENT_MAX_WIDTH_PX = 896;
export const PANE_SIDE_PADDING_PX = 32;

// Both must match the classes on the panes: the detail pane's `lg:w-[50%]`, and the list pane taking the other half when a contact is open. Tailwind's static scanning can't share the literal.
export const LIST_PANE_WIDTH_OPEN_PCT = 50;
export const DETAIL_PANE_WIDTH_PCT = 50;

export function browsingListPane(viewportWidth: number) {
  const width = Math.min(viewportWidth, CONTENT_MAX_WIDTH_PX + 2 * PANE_SIDE_PADDING_PX);
  return { width, marginLeft: (viewportWidth - width) / 2 };
}

export function listPaneTarget(isDesktop: boolean, expanded: boolean, viewportWidth: number) {
  if (!isDesktop) return { width: '100%', marginLeft: 0 };
  if (expanded) return { width: (viewportWidth * LIST_PANE_WIDTH_OPEN_PCT) / 100, marginLeft: 0 };
  return browsingListPane(viewportWidth);
}

// Closed `x` starts the detail pane's left edge at the browsing list pane's right edge, so both edges travel the same distance.
// Both layouts must set the same keys: Framer Motion leaves a property at its last value when the next target omits it, so a missing `width` or `x` would carry one breakpoint's geometry into the other.
export function detailPaneTarget(isDesktop: boolean, expanded: boolean, viewportWidth: number) {
  if (!isDesktop) return { width: '100%', x: 0, opacity: 1 };
  const { width, marginLeft } = browsingListPane(viewportWidth);
  const detailLeft = viewportWidth - (viewportWidth * DETAIL_PANE_WIDTH_PCT) / 100;
  return {
    width: `${DETAIL_PANE_WIDTH_PCT}%`,
    x: expanded ? 0 : marginLeft + width - detailLeft,
    opacity: expanded ? 1 : 0,
  };
}
