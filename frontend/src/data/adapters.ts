export type StationViewModel = Record<string, unknown>;

export function adaptStation(payload: Record<string, unknown>): StationViewModel {
  return payload;
}
