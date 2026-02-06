import type { SqlExecutor } from "../db/types";
import type { DatasetId, DatasetWatermark, ServingViewRecord, ServingViewSpec } from "./types";

type DatasetWatermarkRow = {
  system_id: string;
  dataset_id: string;
  as_of_ts: string | null;
  as_of_text: string | null;
  max_observed_at: string | null;
  updated_at: string;
};

type ServingViewRow = {
  view_id: number;
  system_id: string;
  view_version: string;
  view_spec_sha256: string;
  view_spec_json: unknown;
};

export class PgServingViewStore {
  private readonly db: SqlExecutor;

  constructor(db: SqlExecutor) {
    this.db = db;
  }

  async getWatermark(system_id: string, dataset_id: DatasetId): Promise<DatasetWatermark | null> {
    const rows = await this.db.query<DatasetWatermarkRow>(
      `SELECT system_id, dataset_id, as_of_ts, as_of_text, max_observed_at, updated_at
       FROM dataset_watermarks
       WHERE system_id = $1 AND dataset_id = $2
       LIMIT 1`,
      [system_id, dataset_id]
    );
    if (rows.rows.length === 0) {
      return null;
    }
    const row = rows.rows[0];
    return {
      system_id: row.system_id,
      dataset_id: row.dataset_id,
      as_of_ts: row.as_of_ts ? new Date(row.as_of_ts) : null,
      as_of_text: row.as_of_text,
      max_observed_at: row.max_observed_at ? new Date(row.max_observed_at) : null,
      updated_at: new Date(row.updated_at),
    };
  }

  async listWatermarks(system_id: string, dataset_ids: DatasetId[]): Promise<DatasetWatermark[]> {
    if (dataset_ids.length === 0) {
      return [];
    }
    const rows = await this.db.query<DatasetWatermarkRow>(
      `SELECT system_id, dataset_id, as_of_ts, as_of_text, max_observed_at, updated_at
       FROM dataset_watermarks
       WHERE system_id = $1
         AND dataset_id = ANY($2::text[])
       ORDER BY dataset_id ASC`,
      [system_id, dataset_ids]
    );
    return rows.rows.map((row) => ({
      system_id: row.system_id,
      dataset_id: row.dataset_id,
      as_of_ts: row.as_of_ts ? new Date(row.as_of_ts) : null,
      as_of_text: row.as_of_text,
      max_observed_at: row.max_observed_at ? new Date(row.max_observed_at) : null,
      updated_at: new Date(row.updated_at),
    }));
  }

  async upsertServingView(params: {
    system_id: string;
    view_version: string;
    view_spec_sha256: string;
    view_spec: ServingViewSpec;
  }): Promise<ServingViewRecord> {
    const inserted = await this.db.query<ServingViewRow>(
      `INSERT INTO serving_views (system_id, view_version, view_spec_json, view_spec_sha256)
       VALUES ($1, $2, $3, $4)
       ON CONFLICT (system_id, view_version, view_spec_sha256)
       DO UPDATE SET view_spec_json = EXCLUDED.view_spec_json
       RETURNING view_id, system_id, view_version, view_spec_sha256, view_spec_json`,
      [params.system_id, params.view_version, JSON.stringify(params.view_spec), params.view_spec_sha256]
    );
    const row = inserted.rows[0];
    return {
      view_id: row.view_id,
      system_id: row.system_id,
      view_version: row.view_version,
      view_spec_sha256: row.view_spec_sha256,
      view_spec_json: row.view_spec_json as ServingViewSpec,
    };
  }

  async ensureDataset(dataset_id: DatasetId, note?: string): Promise<void> {
    await this.db.query(
      `INSERT INTO datasets (dataset_id, note)
       VALUES ($1, $2)
       ON CONFLICT (dataset_id) DO NOTHING`,
      [dataset_id, note ?? null]
    );
  }
}
