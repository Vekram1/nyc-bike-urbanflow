"use client";

import { useState } from "react";

export default function ReplayScrubber() {
  const [value, setValue] = useState(0);

  return (
    <label>
      Replay
      <input
        type="range"
        min={0}
        max={100}
        value={value}
        onChange={(event) => setValue(Number(event.target.value))}
      />
    </label>
  );
}
