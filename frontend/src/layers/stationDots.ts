export type StationDot = {
  id: string;
  latitude: number;
  longitude: number;
  risk?: number;
};

export type StationDotStyle = {
  color: string;
};

export function stationDots(data: StationDot[]) {
  return data.map((dot) => ({
    ...dot,
    style: dotStyle(dot),
  }));
}

function dotStyle(dot: StationDot): StationDotStyle {
  const risk = dot.risk ?? 0;
  if (risk >= 0.75) {
    return { color: "#e85d4a" };
  }
  if (risk >= 0.4) {
    return { color: "#f2a541" };
  }
  return { color: "#3a8f6b" };
}
