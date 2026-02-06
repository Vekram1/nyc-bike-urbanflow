export type DatasetId = string;

export type DatasetWatermark = {
  system_id: string;
  dataset_id: DatasetId;
  as_of_ts?: Date | null;
  as_of_text?: string | null;
  max_observed_at?: Date | null;
  updated_at?: Date | null;
};

export type ServingViewVersion = string;

export type ServingViewSpec = {
  system_id: string;
  datasets: Record<DatasetId, { as_of_ts?: string; as_of_text?: string }>;
  severity_version: string;
  severity_spec_sha256: string;
  tile_schema_version: string;
  trips_baseline_id?: string;
  trips_baseline_sha256?: string;
};

export type ServingViewRecord = {
  view_id: number;
  system_id: string;
  view_version: ServingViewVersion;
  view_spec_sha256: string;
  view_spec_json: ServingViewSpec;
};
