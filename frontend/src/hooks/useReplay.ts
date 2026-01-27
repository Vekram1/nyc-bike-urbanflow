import { useEffect, useState } from "react";

import { fetchReplay, ReplayResponse } from "../data/queries";

export function useReplay(baseUrl: string) {
  const [data, setData] = useState<ReplayResponse>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let active = true;
    fetchReplay(baseUrl)
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
