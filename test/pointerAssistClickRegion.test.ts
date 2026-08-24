import { describe, expect, it } from "vitest";
import {
  getPointerAssistClickRegion,
  pointIsInAssistRect,
} from "../electron/main/pointerAssistClickRegion";

describe("pointer assist click regions", () => {
  it("expands an isolated small target", () => {
    const region = getPointerAssistClickRegion(
      { x: 100, y: 100, width: 24, height: 24 },
      []
    );

    expect(region).toEqual({ x: 88, y: 88, width: 48, height: 48 });
    expect(pointIsInAssistRect({ x: 92, y: 112 }, region)).toBe(true);
  });

  it("keeps neighboring click regions from overlapping", () => {
    const first = { x: 100, y: 100, width: 24, height: 24 };
    const second = { x: 136, y: 100, width: 24, height: 24 };
    const firstRegion = getPointerAssistClickRegion(first, [second]);
    const secondRegion = getPointerAssistClickRegion(second, [first]);

    expect(firstRegion.x + firstRegion.width).toBeLessThan(secondRegion.x);
  });

  it("does not expand an already overlapping target pair", () => {
    const target = { x: 100, y: 100, width: 24, height: 24 };
    const region = getPointerAssistClickRegion(target, [
      { x: 116, y: 100, width: 24, height: 24 },
    ]);

    expect(region).toEqual(target);
  });
});
