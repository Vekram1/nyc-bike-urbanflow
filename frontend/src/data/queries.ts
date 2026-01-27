import { fetchJson } from "./api";

export type StateResponse = Record<string, unknown>;
export type ReplayResponse = Array<Record<string, unknown>>;

export function fetchState(baseUrl: string): Promise<StateResponse> {
  return fetchJson<StateResponse>(`${baseUrl}/state`);
}

export function fetchReplay(baseUrl: string): Promise<ReplayResponse> {
  return fetchJson<ReplayResponse>(`${baseUrl}/replay`);
}
