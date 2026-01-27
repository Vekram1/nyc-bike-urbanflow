"use client";

import { useState } from "react";

export default function OptimizationControls() {
  const [horizon, setHorizon] = useState(60);
  const [trucks, setTrucks] = useState(1);
  const [capacity, setCapacity] = useState(20);

  return (
    <div>
      <label>
        Horizon
        <input
          type="number"
          value={horizon}
          onChange={(event) => setHorizon(Number(event.target.value))}
        />
      </label>
      <label>
        Trucks
        <input
          type="number"
          value={trucks}
          onChange={(event) => setTrucks(Number(event.target.value))}
        />
      </label>
      <label>
        Capacity
        <input
          type="number"
          value={capacity}
          onChange={(event) => setCapacity(Number(event.target.value))}
        />
      </label>
    </div>
  );
}
