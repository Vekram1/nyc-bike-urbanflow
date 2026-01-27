export type RebalancingArc = {
  from: [number, number];
  to: [number, number];
  quantity?: number;
};

export function rebalancingArcs(data: RebalancingArc[]) {
  return data;
}
