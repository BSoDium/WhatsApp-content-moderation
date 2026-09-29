import { expect, test } from 'vitest';
import { browsingListPane, detailPaneTarget, listPaneTarget, CONTENT_MAX_WIDTH_PX, PANE_SIDE_PADDING_PX } from './paneLayout';

const MAX_PANE_WIDTH = CONTENT_MAX_WIDTH_PX + 2 * PANE_SIDE_PADDING_PX;

test('a wide viewport gets the capped column, centered', () => {
  expect(browsingListPane(1600)).toEqual({ width: MAX_PANE_WIDTH, marginLeft: (1600 - MAX_PANE_WIDTH) / 2 });
});

test('a viewport narrower than the cap fills it with no margin', () => {
  expect(browsingListPane(900)).toEqual({ width: 900, marginLeft: 0 });
});

test('the browsing column is always centered', () => {
  for (const vw of [1024, 1100, 1300, 1920, 2560]) {
    const { width, marginLeft } = browsingListPane(vw);
    expect(marginLeft * 2 + width).toBe(vw);
  }
});

test('below the desktop breakpoint the list is full width and the detail overlays', () => {
  expect(listPaneTarget(false, false, 800)).toEqual({ width: '100%', marginLeft: 0 });
  expect(listPaneTarget(false, true, 800)).toEqual({ width: '100%', marginLeft: 0 });
  expect(detailPaneTarget(false, true, 800)).toEqual({ width: '100%', opacity: 1 });
});

test('with a contact open the list takes the left half', () => {
  expect(listPaneTarget(true, true, 1200)).toEqual({ width: 600, marginLeft: 0 });
});

test('the detail pane is at rest (x = 0) and visible when open', () => {
  expect(detailPaneTarget(true, true, 1200)).toEqual({ x: 0, opacity: 1 });
});

test('closed, the detail pane starts exactly at the browsing list pane right edge', () => {
  for (const vw of [1024, 1150, 1300, 1920]) {
    const list = browsingListPane(vw);
    const detailNaturalLeft = vw / 2;
    const { x, opacity } = detailPaneTarget(true, false, vw);
    expect(opacity).toBe(0);
    expect(detailNaturalLeft + (x as number)).toBe(list.marginLeft + list.width);
  }
});
