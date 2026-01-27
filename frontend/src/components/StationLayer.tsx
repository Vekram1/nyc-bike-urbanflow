"use client";

import { useStations } from "../hooks/useStations";
import { stationDots } from "../layers/stationDots";

export default function StationLayer() {
  const { data } = useStations();
  const dots = stationDots(
    data.map((station) => ({
      id: String(station.station_id ?? ""),
      latitude: Number(station.lat ?? 0),
      longitude: Number(station.lon ?? 0),
      risk: Number(station.risk ?? 0),
    }))
  );

  return <div>StationLayer {dots.length}</div>;
}
