export type StationDot = {
  id: string;
  latitude: number;
  longitude: number;
  risk?: number;
};

export function stationDots(data: StationDot[]) {
  return data;
}
