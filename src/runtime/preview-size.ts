/** Node preview resolution (square). Separate from preview.ts so UI code can use it without loading three. */
export const PREVIEW_SIZE = 256;

/**
 * Canvas zoom at which node previews (and their value readouts) animate, roughly where
 * the readout numbers are legible. Zoomed out further they hold a still image that only
 * refreshes when the graph or a uniform changes, which keeps panning smooth.
 */
export const LIVE_PREVIEW_ZOOM = 0.75;

/**
 * Frame pacing for a capped frame rate on top of the display's refresh: call once per
 * display frame. Renders when the next slot is due (2 ms slack for timer jitter); slots
 * advance by whole intervals so the average rate holds, and resync after a stall.
 */
export function paceFrame(now: number, nextSlot: number, interval: number): { render: boolean; nextSlot: number } {
  if (now < nextSlot - 2) return { render: false, nextSlot };
  return { render: true, nextSlot: Math.max(nextSlot + interval, now + interval / 2) };
}
