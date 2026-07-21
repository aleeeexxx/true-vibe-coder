export type IntentPoint = {
  x: number;
  y: number;
};

export type IntentRect = IntentPoint & {
  width: number;
  height: number;
};

export type PointerIntentTarget = {
  id: string;
  rect: IntentRect;
  targetPoint: IntentPoint;
  priority: number;
  captureX: number;
  captureY: number;
};

export type PointerIntentMotion = {
  currentPoint: IntentPoint;
  nextPoint: IntentPoint;
  velocity: IntentPoint;
};

export type PointerIntentCandidate = {
  id: string;
  captureProgress: number;
  distance: number;
  score: number;
};

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

function magnitude(vector: IntentPoint): number {
  return Math.hypot(vector.x, vector.y);
}

function alignmentBetween(first: IntentPoint, second: IntentPoint): number {
  const firstMagnitude = magnitude(first);
  const secondMagnitude = magnitude(second);
  if (firstMagnitude < 0.001 || secondMagnitude < 0.001) {
    return 0;
  }

  return clamp(
    (first.x * second.x + first.y * second.y) /
      (firstMagnitude * secondMagnitude),
    -1,
    1
  );
}

function captureMetrics(
  point: IntentPoint,
  target: PointerIntentTarget,
  scale = 1
) {
  const rect = target.rect;
  const overflowX = Math.max(
    rect.x - point.x,
    0,
    point.x - (rect.x + rect.width)
  );
  const overflowY = Math.max(
    rect.y - point.y,
    0,
    point.y - (rect.y + rect.height)
  );
  const captureX = Math.max(1, target.captureX * scale);
  const captureY = Math.max(1, target.captureY * scale);
  const normalizedDistance = Math.max(
    overflowX / captureX,
    overflowY / captureY
  );

  return {
    distance: Math.hypot(overflowX, overflowY),
    normalizedDistance,
    inRange: normalizedDistance <= 1,
  };
}

export function distanceToRect(point: IntentPoint, rect: IntentRect): number {
  const deltaX = Math.max(rect.x - point.x, 0, point.x - (rect.x + rect.width));
  const deltaY = Math.max(rect.y - point.y, 0, point.y - (rect.y + rect.height));
  return Math.hypot(deltaX, deltaY);
}

export function distanceToSegment(
  point: IntentPoint,
  start: IntentPoint,
  end: IntentPoint
): number {
  const segment = { x: end.x - start.x, y: end.y - start.y };
  const segmentLengthSquared = segment.x * segment.x + segment.y * segment.y;
  if (segmentLengthSquared < 0.001) {
    return Math.hypot(point.x - start.x, point.y - start.y);
  }

  const projection = clamp(
    ((point.x - start.x) * segment.x + (point.y - start.y) * segment.y) /
      segmentLengthSquared,
    0,
    1
  );
  const closest = {
    x: start.x + segment.x * projection,
    y: start.y + segment.y * projection,
  };
  return Math.hypot(point.x - closest.x, point.y - closest.y);
}

export function chooseLiveIntentTarget(
  targets: PointerIntentTarget[],
  motion: PointerIntentMotion
): PointerIntentCandidate | null {
  const speed = magnitude(motion.velocity);
  let best: PointerIntentCandidate | null = null;

  targets.forEach((target) => {
    const nextCapture = captureMetrics(motion.nextPoint, target);
    if (!nextCapture.inRange) {
      return;
    }

    const currentCapture = captureMetrics(motion.currentPoint, target);
    const isInsideTarget = nextCapture.normalizedDistance === 0;
    const isApproaching =
      nextCapture.normalizedDistance < currentCapture.normalizedDistance - 0.01;
    if (!isInsideTarget && !isApproaching) {
      return;
    }

    const toTarget = {
      x: target.targetPoint.x - motion.currentPoint.x,
      y: target.targetPoint.y - motion.currentPoint.y,
    };
    const alignment = alignmentBetween(motion.velocity, toTarget);
    if (speed > 120 && alignment < -0.08 && !isInsideTarget) {
      return;
    }

    const captureProgress = 1 - nextCapture.normalizedDistance;
    const smallSide = Math.min(target.rect.width, target.rect.height);
    const smallTargetBoost = clamp((46 - smallSide) / 120, 0, 0.28);
    const score =
      captureProgress * 1.45 +
      Math.max(0, alignment) * 0.24 +
      target.priority * 0.16 +
      smallTargetBoost -
      nextCapture.distance * 0.002;

    if (!best || score > best.score) {
      best = {
        id: target.id,
        captureProgress,
        distance: nextCapture.distance,
        score,
      };
    }
  });

  return best;
}

export function chooseProjectedIntentTarget(
  targets: PointerIntentTarget[],
  motion: PointerIntentMotion,
  searchRadius: number
): PointerIntentCandidate | null {
  const travel = {
    x: motion.nextPoint.x - motion.currentPoint.x,
    y: motion.nextPoint.y - motion.currentPoint.y,
  };
  const travelDistance = magnitude(travel);
  if (travelDistance < 3) {
    return null;
  }

  let best: PointerIntentCandidate | null = null;

  targets.forEach((target) => {
    const toTarget = {
      x: target.targetPoint.x - motion.currentPoint.x,
      y: target.targetPoint.y - motion.currentPoint.y,
    };
    const alignment = alignmentBetween(travel, toTarget);
    if (alignment < 0.08) {
      return;
    }

    const projectedDistance = distanceToRect(motion.nextPoint, target.rect);
    const corridorDistance = distanceToSegment(
      target.targetPoint,
      motion.currentPoint,
      motion.nextPoint
    );
    const corridorRadius = Math.min(
      searchRadius * 0.78,
      Math.max(16, Math.min(target.rect.width, target.rect.height) * 0.55 + 10)
    );
    if (projectedDistance > searchRadius && corridorDistance > corridorRadius) {
      return;
    }

    const projectedProgress = clamp(1 - projectedDistance / searchRadius, 0, 1);
    const corridorProgress = clamp(1 - corridorDistance / corridorRadius, 0, 1);
    const smallSide = Math.min(target.rect.width, target.rect.height);
    const smallTargetBoost = clamp((48 - smallSide) / 110, 0, 0.32);
    const score =
      projectedProgress * 1.2 +
      corridorProgress * 0.52 +
      alignment * 0.46 +
      target.priority * 0.16 +
      smallTargetBoost -
      Math.max(0, travelDistance - 190) * 0.0015;

    if (!best || score > best.score) {
      best = {
        id: target.id,
        captureProgress: Math.max(projectedProgress, corridorProgress * 0.8),
        distance: projectedDistance,
        score,
      };
    }
  });

  return best;
}
