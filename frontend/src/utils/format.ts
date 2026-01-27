export function formatNumber(value: number): string {
  return new Intl.NumberFormat().format(value);
}

export function formatPercent(value: number): string {
  return `${Math.round(value * 100)}%`;
}
