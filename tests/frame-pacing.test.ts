import { describe, expect, it } from "vitest";
import { paceFrame } from "../src/runtime/preview-size";

/** Rendered frames per second for a display refresh rate and a cap, with timing jitter. */
function simulate(displayHz: number, capFps: number, seconds = 5): number {
  const frame = 1000 / displayHz;
  let next = 0;
  let rendered = 0;
  for (let i = 0; i < displayHz * seconds; i++) {
    const now = i * frame + (Math.sin(i * 12.9898) * 0.5 + 0.5) * 0.8; // up to 0.8 ms jitter
    const p = paceFrame(now, next, 1000 / capFps);
    next = p.nextSlot;
    if (p.render) rendered++;
  }
  return rendered / seconds;
}

describe("preview frame cap", () => {
  it("hits the cap when the display is faster", () => {
    expect(simulate(144, 60)).toBeCloseTo(60, -0.5);
    expect(simulate(240, 144)).toBeCloseTo(144, -1);
    expect(simulate(120, 30)).toBeCloseTo(30, -0.5);
    expect(simulate(60, 30)).toBeCloseTo(30, -0.5);
  });

  it("runs at the display rate when the cap is at or above it", () => {
    expect(simulate(60, 60)).toBeCloseTo(60, -0.5);
    expect(simulate(60, 240)).toBeCloseTo(60, -0.5);
    expect(simulate(144, 144)).toBeCloseTo(144, -1);
  });
});
