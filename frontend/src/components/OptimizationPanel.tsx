"use client";

import { useOptimize } from "../hooks/useOptimize";

export default function OptimizationPanel() {
  const { data, runOptimize, loading } = useOptimize();

  return (
    <div>
      <button type="button" onClick={() => void runOptimize()} disabled={loading}>
        {loading ? "Optimizing..." : "Optimize"}
      </button>
      <div>Status: {String(data?.status ?? "idle")}</div>
    </div>
  );
}
