export type AssistRect = {
  x: number;
  y: number;
  width: number;
  height: number;
};

const REGION_GAP = 1;

function expandRect(rect: AssistRect, margin: number): AssistRect {
  return {
    x: rect.x - margin,
    y: rect.y - margin,
    width: rect.width + margin * 2,
    height: rect.height + margin * 2,
  };
}

function rectsOverlap(first: AssistRect, second: AssistRect): boolean {
  return (
    first.x < second.x + second.width &&
    first.x + first.width > second.x &&
    first.y < second.y + second.height &&
    first.y + first.height > second.y
  );
}

export function getPointerAssistClickRegion(
  target: AssistRect,
  peers: AssistRect[],
  desiredMargin = 12
): AssistRect {
  const margin = Math.max(0, desiredMargin);
  const overlapsAtMargin = (candidate: number) => {
    const expandedTarget = expandRect(target, candidate);
    return peers.some((peer) =>
      rectsOverlap(
        expandedTarget,
        expandRect(peer, candidate + REGION_GAP / 2)
      )
    );
  };

  if (!overlapsAtMargin(margin)) {
    return expandRect(target, margin);
  }

  let low = 0;
  let high = margin;

  for (let index = 0; index < 16; index += 1) {
    const candidate = (low + high) / 2;
    if (overlapsAtMargin(candidate)) {
      high = candidate;
    } else {
      low = candidate;
    }
  }

  return expandRect(target, Math.floor(low * 2) / 2);
}

export function pointIsInAssistRect(
  point: { x: number; y: number },
  rect: AssistRect
): boolean {
  return (
    point.x >= rect.x &&
    point.x <= rect.x + rect.width &&
    point.y >= rect.y &&
    point.y <= rect.y + rect.height
  );
}
