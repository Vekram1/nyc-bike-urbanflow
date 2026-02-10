export type RolloutStage = "shadow" | "internal" | "public";

export type RolloutMetrics = {
  timeout_rate: number;
  fallback_rate: number;
  objective_delta_ratio: number;
};

export type RolloutGateResult = {
  stage: RolloutStage;
  pass: boolean;
  reasons: string[];
  thresholds: {
    max_timeout_rate: number;
    max_fallback_rate: number;
    min_objective_delta_ratio: number;
  };
};

const THRESHOLDS: Record<RolloutStage, RolloutGateResult["thresholds"]> = {
  shadow: {
    max_timeout_rate: 0.15,
    max_fallback_rate: 0.2,
    min_objective_delta_ratio: -0.2,
  },
  internal: {
    max_timeout_rate: 0.08,
    max_fallback_rate: 0.1,
    min_objective_delta_ratio: -0.1,
  },
  public: {
    max_timeout_rate: 0.03,
    max_fallback_rate: 0.05,
    min_objective_delta_ratio: -0.03,
  },
};

export function evaluateRolloutGate(stage: RolloutStage, metrics: RolloutMetrics): RolloutGateResult {
  const thresholds = THRESHOLDS[stage];
  const reasons: string[] = [];
  if (metrics.timeout_rate > thresholds.max_timeout_rate) {
    reasons.push(
      `timeout_rate ${metrics.timeout_rate.toFixed(4)} exceeds ${thresholds.max_timeout_rate.toFixed(4)}`
    );
  }
  if (metrics.fallback_rate > thresholds.max_fallback_rate) {
    reasons.push(
      `fallback_rate ${metrics.fallback_rate.toFixed(4)} exceeds ${thresholds.max_fallback_rate.toFixed(4)}`
    );
  }
  if (metrics.objective_delta_ratio < thresholds.min_objective_delta_ratio) {
    reasons.push(
      `objective_delta_ratio ${metrics.objective_delta_ratio.toFixed(4)} below ${thresholds.min_objective_delta_ratio.toFixed(4)}`
    );
  }
  return {
    stage,
    pass: reasons.length === 0,
    reasons,
    thresholds,
  };
}
