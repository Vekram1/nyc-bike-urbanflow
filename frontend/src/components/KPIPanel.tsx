"use client";

import { useEffect, useState } from "react";

import { fetchJson } from "../data/api";
import { apiBaseUrl } from "../data/config";

export default function KPIPanel() {
  const [metrics, setMetrics] = useState<Record<string, unknown>>({});

  useEffect(() => {
    fetchJson<Record<string, unknown>>(`${apiBaseUrl()}/metrics`).then(setMetrics);
  }, []);

  return (
    <section>
      <h2>KPIs</h2>
      <div>Operational failures: {String(metrics.failure_minutes ?? "-")}</div>
      <div>Unreliable minutes: {String(metrics.unreliable_minutes ?? "-")}</div>
    </section>
  );
}
