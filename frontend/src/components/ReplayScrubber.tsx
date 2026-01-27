"use client";

import { useState } from "react";

import { useReplay } from "../hooks/useReplay";

export default function ReplayScrubber() {
  const { data } = useReplay();
  const [value, setValue] = useState(0);

  return (
    <label>
      Replay
      <input
        type="range"
        min={0}
        max={Math.max(data.length - 1, 0)}
        value={value}
        onChange={(event) => setValue(Number(event.target.value))}
      />
    </label>
  );
}
