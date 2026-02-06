export type PolicyInputStation = {
  station_key: string;
  capacity: number;
  bikes: number;
  docks: number;
  bucket_quality: string;
};

export type PolicyNeighborEdge = {
  from_station_key: string;
  to_station_key: string;
  dist_m: number;
  rank: number;
};

export type GreedyPolicySpec = {
  targets: {
    type: "band_fraction_of_capacity";
    alpha: number;
    beta: number;
    min_capacity_for_policy: number;
    inactive_station_behavior: "ignore";
  };
  effort: {
    bike_move_budget_per_step: number;
    max_stations_touched: number;
    max_moves: number;
  };
  neighborhood: {
    type: "explicit_neighbors";
    max_neighbors: number;
    neighbor_radius_m: number;
    distance_metric: "haversine";
    edges: PolicyNeighborEdge[];
  };
  scoring: {
    type: "min_distance_then_max_transfer";
    epsilon_m: number;
  };
  constraints: {
    respect_capacity_bounds: boolean;
    forbid_donating_below_L: boolean;
    forbid_receiving_above_U: boolean;
  };
  missing_data: {
    input_bucket_quality_allowed: string[];
    carry_forward_window_s: number;
    on_missing: "skip_station";
  };
};

export type GreedyPolicyInput = {
  policy_version: string;
  system_id: string;
  decision_bucket_ts: number;
  bucket_size_s: number;
  spec: GreedyPolicySpec;
  stations: PolicyInputStation[];
};

export type GreedyPolicyMove = {
  from_station_key: string;
  to_station_key: string;
  bikes_moved: number;
  dist_m: number;
  rank: number;
  reason_codes: string[];
};

export type GreedyPolicyStationTouched = {
  station_key: string;
  capacity: number;
  bikes_before: number;
  bikes_after: number;
  L_s: number;
  U_s: number;
  need_before: number;
  excess_before: number;
};

export type GreedyPolicyOutput = {
  policy_version: string;
  policy_spec_sha256: string;
  system_id: string;
  decision_bucket_ts: number;
  effort: GreedyPolicySpec["effort"];
  moves: GreedyPolicyMove[];
  stations_touched: GreedyPolicyStationTouched[];
  summary: {
    bikes_moved_total: number;
    stations_touched: number;
    no_op: boolean;
  };
};

export type PolicyLogger = {
  info: (event: string, details: Record<string, unknown>) => void;
};
