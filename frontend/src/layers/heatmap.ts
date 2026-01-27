export type HeatmapPoint = {
  latitude: number;
  longitude: number;
  weight?: number;
};

export function heatmapPoints(data: HeatmapPoint[]) {
  return data;
}
