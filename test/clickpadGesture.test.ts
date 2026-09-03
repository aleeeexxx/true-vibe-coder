import { describe, expect, it } from "vitest";
import {
  accumulateClickpadRingScroll,
  getClickpadClockwiseAngle,
  getClickpadClockwiseDelta,
  getClickpadClockwiseDeltaFromPoints,
  getClickpadGestureZone,
  getClickpadRingScrollPixels,
  isTrackableClickpadContact,
} from "../src/utils/clickpadGesture";

describe("clickpad gesture zones", () => {
  it("uses the inner circle for pointer movement", () => {
    expect(getClickpadGestureZone(0.5, 0.5)).toBe("pointer");
    expect(getClickpadGestureZone(0.68, 0.5)).toBe("pointer");
  });

  it("uses the outer ring for circular scrolling", () => {
    expect(getClickpadGestureZone(0.5, 0.92)).toBe("ring");
    expect(getClickpadGestureZone(0.92, 0.5)).toBe("ring");
    expect(getClickpadGestureZone(0.81, 0.5)).toBe("ring");
  });

  it("keeps the active zone stable near the boundary", () => {
    expect(getClickpadGestureZone(0.78, 0.5, "pointer")).toBe("pointer");
    expect(getClickpadGestureZone(0.78, 0.5, "ring")).toBe("ring");
  });

  it("keeps scrolling locked even when the finger drifts into the center", () => {
    expect(getClickpadGestureZone(0.55, 0.5, "ring", true)).toBe("ring");
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

  it("keeps a continuous delta while crossing the left side", () => {
    const delta = getClickpadClockwiseDeltaFromPoints(
      0.05,
      0.54,
      0.05,
      0.46
    );

    expect(delta).toBeLessThan(0);
    expect(Math.abs(delta)).toBeCloseTo(0.177, 2);
  });

  it("crosses the absolute-angle seam without losing movement", () => {
    const delta = getClickpadClockwiseDeltaFromPoints(
      0.54,
      0.05,
      0.46,
      0.05
    );

    expect(delta).toBeGreaterThan(0);
    expect(Math.abs(delta)).toBeCloseTo(0.177, 2);
  });

  it("keeps every sample moving in the same direction for a full turn", () => {
    const points = Array.from({ length: 73 }, (_, index) => {
      const angle = (index * Math.PI * 2) / 72;
      return {
        x: 0.5 + Math.sin(angle) * 0.45,
        y: 0.5 + Math.cos(angle) * 0.45,
      };
    });

    for (let index = 1; index < points.length; index += 1) {
      const previous = points[index - 1];
      const current = points[index];
      const delta = getClickpadClockwiseDeltaFromPoints(
        previous.x,
        previous.y,
        current.x,
        current.y
      );

      expect(delta).toBeGreaterThan(0);
      expect(getClickpadRingScrollPixels(delta)).toBeGreaterThan(0);
    }
  });

  it("keeps low-pressure ring contact trackable after ring lock", () => {
    expect(isTrackableClickpadContact(4, 0.05, 0.5, 0.02)).toBe(true);
    expect(isTrackableClickpadContact(4, 0.05, 0.5, 0)).toBe(false);
    expect(isTrackableClickpadContact(0, 0.05, 0.5, 0.2)).toBe(false);
  });

  it("accumulates small movements instead of dropping slow rotation", () => {
    const first = accumulateClickpadRingScroll(0, 0.0012);
    const second = accumulateClickpadRingScroll(first.angleRemainder, 0.0012);
    const third = accumulateClickpadRingScroll(second.angleRemainder, 0.0012);

    expect(first.pixels).toBe(0);
    expect(second.pixels).toBe(0);
    expect(third.pixels).toBeGreaterThan(0);
    expect(third.angleRemainder).toBe(0);
  });

  it("keeps scrolling after a delayed sample instead of dropping the frame", () => {
    expect(getClickpadRingScrollPixels(0.7)).toBe(170);
    expect(getClickpadRingScrollPixels(-0.7)).toBe(-170);
  });
});
