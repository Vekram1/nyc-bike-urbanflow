export function riskColor(risk: number): string {
  if (risk >= 0.75) {
    return "#e85d4a";
  }
  if (risk >= 0.4) {
    return "#f2a541";
  }
  return "#3a8f6b";
}
