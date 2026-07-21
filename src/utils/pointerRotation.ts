export type PointerRotation = 0 | 90 | 180 | 270;

export function normalizePointerRotation(value: unknown): PointerRotation {
  const numericValue = Number(value);
  return numericValue === 90 || numericValue === 180 || numericValue === 270
    ? numericValue
    : 0;
}
