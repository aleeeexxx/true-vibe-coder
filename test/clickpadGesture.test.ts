import { describe, expect, it } from "vitest";
import {
  getClickpadClockwiseAngle,
  getClickpadClockwiseDelta,
  getClickpadGestureZone,
  getClickpadRingScrollPixels,
} from "../src/utils/clickpadGesture";

describe("clickpad gesture zones", () => {
  it("uses the inner circle for pointer movement", () => {
    expect(getClickpadGestureZone(0.5, 0.5)).toBe("pointer");
    expect(getClickpadGestureZone(0.68, 0.5)).toBe("pointer");
  });

  it("uses the outer ring for circular scrolling", () => {
    expect(getClickpadGestureZone(0.5, 0.92)).toBe("ring");
    expect(getClickpadGestureZone(0.92, 0.5)).toBe("ring");
  });

  it("keeps the active zone stable near the boundary", () => {
    expect(getClickpadGestureZone(0.83, 0.5, "pointer")).toBe("pointer");
    expect(getClickpadGestureZone(0.83, 0.5, "ring")).toBe("ring");
  });
});

describe("clickpad ring scrolling", () => {
  it("maps clockwise movement to positive downward scrolling", () => {
    const top = getClickpadClockwiseAngle(0.5, 0.95);
    const right = getClickpadClockwiseAngle(0.95, 0.5);
    const delta = getClickpadClockwiseDelta(top, right);

    expect(delta).toBeGreaterThan(0);
    expect(getClickpadRingScrollPixels(delta / 8)).toBeGreaterThan(0);
  });

  it("maps counterclockwise movement to negative upward scrolling", () => {
    const top = getClickpadClockwiseAngle(0.5, 0.95);
    const left = getClickpadClockwiseAngle(0.05, 0.5);
    const delta = getClickpadClockwiseDelta(top, left);

    expect(delta).toBeLessThan(0);
    expect(getClickpadRingScrollPixels(delta / 8)).toBeLessThan(0);
  });

  it("unwraps movement across the angle boundary", () => {
    const previous = Math.PI - 0.04;
    const current = -Math.PI + 0.05;
    expect(getClickpadClockwiseDelta(previous, current)).toBeCloseTo(0.09, 5);
  });
});
