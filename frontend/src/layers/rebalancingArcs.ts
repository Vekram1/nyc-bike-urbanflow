export type RebalancingArc = {
  from: [number, number];
  to: [number, number];
  quantity?: number;
};

export type RebalancingLine = {
  path: Array<[number, number]>;
  quantity?: number;
};

export function rebalancingArcs(data: RebalancingArc[]) {
  return data;
}

export function rebalancingLines(data: RebalancingLine[]) {
  return data;
}
