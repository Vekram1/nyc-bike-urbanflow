import type { DatasetId, DatasetWatermark } from "./types";

export type TimeDatasetSummary = {
  dataset_id: string;
  as_of: string;
  max_observed_at: string | null;
  ingest_lag_s: number | null;
};

export type TimeEndpointOk = {
  ok: true;
  status: 200;
  body: {
    server_now: string;
    datasets: TimeDatasetSummary[];
    recommended_live_sv: string;
    view_id: number;
    view_spec_sha256: string;
  };
};

export type TimeEndpointErr = {
  ok: false;
  status: 400 | 500;
  body: {
    error: {
      code: string;
      message: string;
    };
  };
};

type Clock = () => Date;

function watermarkAsOf(wm: DatasetWatermark): string {
  if (wm.as_of_ts) {
    return wm.as_of_ts.toISOString();
  }
  return wm.as_of_text ?? "unknown";
}

function ingestLagSeconds(now: Date, wm: DatasetWatermark): number | null {
  if (!wm.max_observed_at) {
    return null;
  }
  const lagMs = now.getTime() - wm.max_observed_at.getTime();
  return lagMs >= 0 ? Math.floor(lagMs / 1000) : 0;
}

export async function buildTimeEndpointResponse(params: {
  servingViews: {
    mintLiveToken: (args: {
      system_id: string;
      view_version: string;
      ttl_seconds: number;
      tile_schema_version: string;
      severity_version: string;
      severity_spec_sha256: string;
      required_datasets: DatasetId[];
      optional_datasets?: DatasetId[];
    }) => Promise<
      | { ok: true; sv: string; view_spec_sha256: string; view_id: number }
      | { ok: false; status: 400 | 500; code: string; message: string }
    >;
  };
  viewStore: {
    listWatermarks: (system_id: string, dataset_ids: DatasetId[]) => Promise<DatasetWatermark[]>;
  };
  system_id: string;
  view_version: string;
  ttl_seconds: number;
  tile_schema_version: string;
  severity_version: string;
  severity_spec_sha256: string;
  required_datasets: DatasetId[];
  optional_datasets?: DatasetId[];
  clock?: Clock;
}): Promise<TimeEndpointOk | TimeEndpointErr> {
  const now = (params.clock ?? (() => new Date()))();
  const datasetIds = Array.from(
    new Set([...(params.required_datasets ?? []), ...(params.optional_datasets ?? [])])
  );
  const rows = await params.viewStore.listWatermarks(params.system_id, datasetIds);
  const byDataset = new Map(rows.map((row) => [row.dataset_id, row]));

  const missingRequired = params.required_datasets.find((dataset_id) => !byDataset.has(dataset_id));
  if (missingRequired) {
    return {
      ok: false,
      status: 500,
      body: {
        error: {
          code: "missing_watermark",
          message: `Missing dataset watermark: ${missingRequired}`,
        },
      },
    };
  }

  const minted = await params.servingViews.mintLiveToken({
    system_id: params.system_id,
    view_version: params.view_version,
    ttl_seconds: params.ttl_seconds,
    tile_schema_version: params.tile_schema_version,
    severity_version: params.severity_version,
    severity_spec_sha256: params.severity_spec_sha256,
    required_datasets: params.required_datasets,
    optional_datasets: params.optional_datasets,
  });
  if (!minted.ok) {
    return {
      ok: false,
      status: minted.status,
      body: { error: { code: minted.code, message: minted.message } },
    };
  }

  const datasets: TimeDatasetSummary[] = rows.map((wm) => ({
    dataset_id: wm.dataset_id,
    as_of: watermarkAsOf(wm),
    max_observed_at: wm.max_observed_at ? wm.max_observed_at.toISOString() : null,
    ingest_lag_s: ingestLagSeconds(now, wm),
  }));

  return {
    ok: true,
    status: 200,
    body: {
      server_now: now.toISOString(),
      datasets,
      recommended_live_sv: minted.sv,
      view_id: minted.view_id,
      view_spec_sha256: minted.view_spec_sha256,
    },
  };
}
