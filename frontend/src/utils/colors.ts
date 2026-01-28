type RiskStop = {
  min: number;
  color: string;
  label: string;
};

export const riskStops: RiskStop[] = [
  { min: 0.75, color: "#e85d4a", label: "High" },
  { min: 0.4, color: "#f2a541", label: "Medium" },
  { min: 0, color: "#3a8f6b", label: "Low" },
];

export function riskColor(risk: number): string {
  const clamped = Math.max(0, Math.min(1, risk));

  for (const stop of riskStops) {
    if (clamped >= stop.min) {
      return stop.color;
    }
  }

  return riskStops[riskStops.length - 1].color;
}
