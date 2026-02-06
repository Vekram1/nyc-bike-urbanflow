-- nyc-bike-urbanflow-9pz: policy outputs + evaluation marts
-- Persistent policy run outputs and daily eval aggregates keyed by policy namespace + sv.

BEGIN;

CREATE TABLE IF NOT EXISTS policy_runs (
  run_id BIGSERIAL PRIMARY KEY,
  system_id TEXT NOT NULL REFERENCES systems(system_id),
  policy_version TEXT NOT NULL,
  policy_spec_sha256 TEXT NOT NULL,
  sv TEXT NOT NULL,
  decision_bucket_ts TIMESTAMPTZ NOT NULL,
  horizon_steps INTEGER NOT NULL DEFAULT 0,
  input_quality TEXT NOT NULL DEFAULT 'ok',
  status TEXT NOT NULL,
  no_op BOOLEAN NOT NULL DEFAULT FALSE,
  no_op_reason TEXT,
  error_reason TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CHECK (horizon_steps >= 0),
  CHECK (input_quality IN ('ok', 'carried_forward', 'missing', 'blocked')),
  CHECK (status IN ('success', 'fail')),
  CHECK (no_op_reason IS NULL OR no_op_reason IN (
    'no_deficits',
    'no_surpluses',
    'neighborhood_blocked',
    'budget_zero',
    'input_quality_blocked'
  )),
  CHECK ((status = 'fail') = (error_reason IS NOT NULL))
);

CREATE UNIQUE INDEX IF NOT EXISTS policy_runs_namespace_key_idx
  ON policy_runs (system_id, policy_version, policy_spec_sha256, sv, decision_bucket_ts, horizon_steps);
CREATE INDEX IF NOT EXISTS policy_runs_created_idx
  ON policy_runs (system_id, created_at DESC);
CREATE INDEX IF NOT EXISTS policy_runs_decision_idx
  ON policy_runs (system_id, decision_bucket_ts DESC, policy_version);

CREATE TABLE IF NOT EXISTS policy_moves (
  run_id BIGINT NOT NULL REFERENCES policy_runs(run_id) ON DELETE CASCADE,
  move_rank INTEGER NOT NULL,
  from_station_key TEXT NOT NULL,
  to_station_key TEXT NOT NULL,
  bikes_moved INTEGER NOT NULL,
  dist_m DOUBLE PRECISION NOT NULL,
  budget_exhausted BOOLEAN NOT NULL DEFAULT FALSE,
  neighbor_exhausted BOOLEAN NOT NULL DEFAULT FALSE,
  reason_codes TEXT[] NOT NULL DEFAULT ARRAY[]::text[],
  PRIMARY KEY (run_id, move_rank),
  CHECK (move_rank >= 1),
  CHECK (bikes_moved > 0),
  CHECK (dist_m >= 0)
);

CREATE INDEX IF NOT EXISTS policy_moves_from_idx
  ON policy_moves (from_station_key);
CREATE INDEX IF NOT EXISTS policy_moves_to_idx
  ON policy_moves (to_station_key);

CREATE TABLE IF NOT EXISTS policy_counterfactual_status (
  run_id BIGINT NOT NULL REFERENCES policy_runs(run_id) ON DELETE CASCADE,
  sim_bucket_ts TIMESTAMPTZ NOT NULL,
  station_key TEXT NOT NULL,
  bikes INTEGER NOT NULL,
  docks INTEGER NOT NULL,
  bucket_quality TEXT NOT NULL,
  PRIMARY KEY (run_id, sim_bucket_ts, station_key),
  CHECK (bikes >= 0),
  CHECK (docks >= 0),
  CHECK (bucket_quality IN ('ok', 'carried_forward', 'missing', 'blocked'))
);

CREATE INDEX IF NOT EXISTS policy_counterfactual_status_station_idx
  ON policy_counterfactual_status (station_key, sim_bucket_ts DESC);

CREATE TABLE IF NOT EXISTS policy_eval_daily (
  day DATE NOT NULL,
  system_id TEXT NOT NULL REFERENCES systems(system_id),
  policy_version TEXT NOT NULL,
  policy_spec_sha256 TEXT NOT NULL,
  sv TEXT NOT NULL,
  baseline_empty_minutes INTEGER NOT NULL DEFAULT 0,
  policy_empty_minutes INTEGER NOT NULL DEFAULT 0,
  delta_empty_minutes INTEGER NOT NULL DEFAULT 0,
  baseline_full_minutes INTEGER NOT NULL DEFAULT 0,
  policy_full_minutes INTEGER NOT NULL DEFAULT 0,
  delta_full_minutes INTEGER NOT NULL DEFAULT 0,
  effort_bikes_moved INTEGER NOT NULL DEFAULT 0,
  effort_stations_touched INTEGER NOT NULL DEFAULT 0,
  mean_move_dist_m DOUBLE PRECISION NOT NULL DEFAULT 0,
  delta_empty_full_per_100_bikes_moved DOUBLE PRECISION NOT NULL DEFAULT 0,
  computed_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (day, system_id, policy_version, policy_spec_sha256, sv)
);

CREATE INDEX IF NOT EXISTS policy_eval_daily_system_day_idx
  ON policy_eval_daily (system_id, day DESC);

CREATE OR REPLACE FUNCTION refresh_policy_eval_daily(
  p_system_id TEXT,
  p_from_day DATE,
  p_to_day DATE
) RETURNS INTEGER
LANGUAGE plpgsql
AS $$
DECLARE
  v_upserted INTEGER := 0;
BEGIN
  WITH run_days AS (
    SELECT
      DATE_TRUNC('day', r.decision_bucket_ts)::date AS day,
      r.system_id,
      r.policy_version,
      r.policy_spec_sha256,
      r.sv,
      r.run_id
    FROM policy_runs r
    WHERE r.system_id = p_system_id
      AND DATE_TRUNC('day', r.decision_bucket_ts)::date >= p_from_day
      AND DATE_TRUNC('day', r.decision_bucket_ts)::date <= p_to_day
      AND r.status = 'success'
  ),
  move_rollup AS (
    SELECT
      d.day,
      d.system_id,
      d.policy_version,
      d.policy_spec_sha256,
      d.sv,
      COALESCE(SUM(m.bikes_moved), 0) AS effort_bikes_moved,
      COALESCE(COUNT(DISTINCT m.from_station_key) + COUNT(DISTINCT m.to_station_key), 0) AS effort_stations_touched,
      COALESCE(AVG(m.dist_m), 0) AS mean_move_dist_m
    FROM run_days d
    LEFT JOIN policy_moves m ON m.run_id = d.run_id
    GROUP BY d.day, d.system_id, d.policy_version, d.policy_spec_sha256, d.sv
  ),
  upserted AS (
    INSERT INTO policy_eval_daily (
      day,
      system_id,
      policy_version,
      policy_spec_sha256,
      sv,
      effort_bikes_moved,
      effort_stations_touched,
      mean_move_dist_m,
      computed_at
    )
    SELECT
      r.day,
      r.system_id,
      r.policy_version,
      r.policy_spec_sha256,
      r.sv,
      r.effort_bikes_moved,
      r.effort_stations_touched,
      r.mean_move_dist_m,
      NOW()
    FROM move_rollup r
    ON CONFLICT (day, system_id, policy_version, policy_spec_sha256, sv)
    DO UPDATE SET
      effort_bikes_moved = EXCLUDED.effort_bikes_moved,
      effort_stations_touched = EXCLUDED.effort_stations_touched,
      mean_move_dist_m = EXCLUDED.mean_move_dist_m,
      computed_at = NOW()
    RETURNING 1
  )
  SELECT COUNT(*) INTO v_upserted FROM upserted;

  RETURN v_upserted;
END;
$$;

COMMIT;
