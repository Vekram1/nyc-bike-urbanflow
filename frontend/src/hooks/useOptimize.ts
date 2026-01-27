import { useCallback, useState } from "react";

import { fetchJson } from "../data/api";
import { apiBaseUrl } from "../data/config";

export type OptimizeResponse = Record<string, unknown>;

export function useOptimize(baseUrl: string = apiBaseUrl()) {
  const [data, setData] = useState<OptimizeResponse | null>(null);
  const [loading, setLoading] = useState(false);

  const runOptimize = useCallback(async () => {
    setLoading(true);
    try {
      const response = await fetchJson<OptimizeResponse>(`${baseUrl}/optimize`);
      setData(response);
    } finally {
      setLoading(false);
    }
  }, [baseUrl]);

  return { data, loading, runOptimize };
}
