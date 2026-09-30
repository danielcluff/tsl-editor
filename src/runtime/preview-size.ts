/** Node preview resolution (square). Separate from preview.ts so UI code can use it without loading three. */
export const PREVIEW_SIZE = 256;

/**
 * Canvas zoom at which node previews (and their value readouts) animate, roughly where
 * the readout numbers are legible. Zoomed out further they hold a still image that only
 * refreshes when the graph or a uniform changes, which keeps panning smooth.
 */
export const LIVE_PREVIEW_ZOOM = 0.75;
