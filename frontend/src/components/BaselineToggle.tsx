"use client";

import { useState } from "react";

type Mode = "baseline" | "plan" | "difference";

export default function BaselineToggle() {
  const [mode, setMode] = useState<Mode>("baseline");

  return (
    <div>
      <button type="button" onClick={() => setMode("baseline")}
        aria-pressed={mode === "baseline"}
      >
        Baseline
      </button>
      <button type="button" onClick={() => setMode("plan")}
        aria-pressed={mode === "plan"}
      >
        Plan
      </button>
      <button type="button" onClick={() => setMode("difference")}
        aria-pressed={mode === "difference"}
      >
        Difference
      </button>
    </div>
  );
}
