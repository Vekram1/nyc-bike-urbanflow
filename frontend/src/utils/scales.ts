type RadiusOptions = {
  minRadius?: number;
  maxRadius?: number;
  maxBikes?: number;
};

export function bikesToRadius(
  bikesAvailable: number,
  options: RadiusOptions = {}
): number {
  const minRadius = options.minRadius ?? 3;
  const maxRadius = options.maxRadius ?? 16;
  const maxBikes = options.maxBikes ?? 50;
  const clamped = Math.max(0, Math.min(bikesAvailable, maxBikes));
  const normalized = Math.sqrt(clamped / maxBikes);

  return minRadius + (maxRadius - minRadius) * normalized;
}
