export type ClickpadGestureZone = "pointer" | "ring";

const RING_ENTER_RADIUS = 0.35;
const RING_EXIT_RADIUS = 0.31;
const MIN_RING_ANGLE_DELTA = 0.003;
const MAX_RING_ANGLE_DELTA = 0.55;
const RING_SCROLL_PIXELS_PER_RADIAN = 310;

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}

export function getClickpadGestureZone(
  x: number,
  y: number,
  previousZone?: ClickpadGestureZone
): ClickpadGestureZone {
  const radius = Math.hypot(x - 0.5, y - 0.5);

  if (previousZone === "ring") {
    return radius <= RING_EXIT_RADIUS ? "pointer" : "ring";
  }

  return radius >= RING_ENTER_RADIUS ? "ring" : "pointer";
}

export function getClickpadClockwiseAngle(x: number, y: number): number {
  return Math.atan2(x - 0.5, y - 0.5);
}

export function getClickpadClockwiseDelta(
  previousAngle: number,
  currentAngle: number
): number {
  const rawDelta = currentAngle - previousAngle;
  return Math.atan2(Math.sin(rawDelta), Math.cos(rawDelta));
}

export function getClickpadRingScrollPixels(angleDelta: number): number {
  if (
    Math.abs(angleDelta) < MIN_RING_ANGLE_DELTA ||
    Math.abs(angleDelta) > MAX_RING_ANGLE_DELTA
  ) {
    return 0;
  }

  return clamp(angleDelta * RING_SCROLL_PIXELS_PER_RADIAN, -170, 170);
}
