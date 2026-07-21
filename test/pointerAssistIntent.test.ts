import { describe, expect, it } from "vitest";
import {
  chooseLiveIntentTarget,
  chooseProjectedIntentTarget,
  PointerIntentTarget,
} from "../electron/main/pointerAssistIntent";

function target(id: string, x: number, y = 40): PointerIntentTarget {
  return {
    id,
    rect: { x, y, width: 24, height: 24 },
    targetPoint: { x: x + 12, y: y + 12 },
    priority: 1.25,
    captureX: 24,
    captureY: 24,
  };
}

describe("pointer intent selection", () => {
  it("captures a small target before the pointer reaches its visible bounds", () => {
    const result = chooseLiveIntentTarget([target("mic", 100)], {
      currentPoint: { x: 65, y: 52 },
      nextPoint: { x: 80, y: 52 },
      velocity: { x: 520, y: 0 },
    });

    expect(result?.id).toBe("mic");
    expect(result?.captureProgress).toBeGreaterThan(0);
  });

  it("selects exactly one adjacent target from pointer direction", () => {
    const result = chooseLiveIntentTarget(
      [target("left", 100), target("right", 136)],
      {
        currentPoint: { x: 124, y: 52 },
        nextPoint: { x: 132, y: 52 },
        velocity: { x: 400, y: 0 },
      }
    );

    expect(result?.id).toBe("right");
  });

  it("uses the projected lift position to catch a flicked pointer", () => {
    const result = chooseProjectedIntentTarget(
      [target("send", 150)],
      {
        currentPoint: { x: 70, y: 52 },
        nextPoint: { x: 138, y: 52 },
        velocity: { x: 900, y: 0 },
      },
      42
    );

    expect(result?.id).toBe("send");
  });

  it("does not snap to a target behind the projected movement", () => {
    const result = chooseProjectedIntentTarget(
      [target("behind", 40)],
      {
        currentPoint: { x: 100, y: 52 },
        nextPoint: { x: 170, y: 52 },
        velocity: { x: 900, y: 0 },
      },
      52
    );

    expect(result).toBeNull();
  });
});
