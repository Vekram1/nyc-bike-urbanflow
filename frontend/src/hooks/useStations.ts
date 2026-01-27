import { useEffect, useState } from "react";

import { fetchJson } from "../data/api";
import { apiBaseUrl } from "../data/config";

export type StationsResponse = Array<Record<string, unknown>>;

export function useStations(baseUrl: string = apiBaseUrl()) {
  const [data, setData] = useState<StationsResponse>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let active = true;
    fetchJson<StationsResponse>(`${baseUrl}/stations`)
      .then((response) => {
        if (active) {
          setData(response);
        }
      })
      .finally(() => {
        if (active) {
          setLoading(false);
        }
      });

    return () => {
      active = false;
    };
  }, [baseUrl]);

  return { data, loading };
}
