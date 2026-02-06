import crypto from "crypto";
import fs from "fs/promises";
import path from "path";

import type { SqlExecutor } from "../db/types";

export type TripsBaselineManifest = {
  dataset_id: string;
  as_of: string;
  checksum_sha256: string;
  filename: string;
  row_count: number;
  schema_version: string;
  source: string;
};

export type TripRecord = {
  trip_id: string;
  started_at: string;
  ended_at: string;
  start_station_id: string;
  end_station_id: string;
  member_type: string;
  duration_s: number;
};

type FlowAggregate = {
  station_key: string;
  period_month: string;
  trips: number;
  total_duration_s: number;
  member_trips: number;
  casual_trips: number;
};

export type TripsBaselineIngestResult = {
  dataset_id: string;
  period_month: string;
  row_count: number;
  station_outflows_rows: number;
  station_inflows_rows: number;
};

function parseCsv(text: string): TripRecord[] {
  const lines = text.trim().split("\n");
  if (lines.length < 2) {
    return [];
  }
  const header = lines[0]?.split(",") ?? [];
  const expected = [
    "trip_id",
    "started_at",
    "ended_at",
    "start_station_id",
    "end_station_id",
    "member_type",
    "duration_s",
  ];
  if (header.join(",") !== expected.join(",")) {
    throw new Error("invalid_trips_header");
  }
  return lines.slice(1).map((line) => {
    const values = line.split(",");
    return {
      trip_id: values[0] ?? "",
      started_at: values[1] ?? "",
      ended_at: values[2] ?? "",
      start_station_id: values[3] ?? "",
      end_station_id: values[4] ?? "",
      member_type: values[5] ?? "",
      duration_s: Number(values[6] ?? "0"),
    };
  });
}

function periodMonthFromIso(isoTs: string): string {
  const d = new Date(isoTs);
  if (Number.isNaN(d.getTime())) {
    throw new Error("invalid_started_at");
  }
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}-01`;
}

function sha256Hex(payload: string): string {
  const hash = crypto.createHash("sha256");
  hash.update(payload);
  return hash.digest("hex");
}

function validateQualityGate(records: TripRecord[], manifest: TripsBaselineManifest, csvText: string): string {
  if (records.length !== manifest.row_count) {
    throw new Error("row_count_mismatch");
  }
  if (!manifest.as_of.startsWith("sha256=")) {
    throw new Error("invalid_manifest_as_of");
  }
  const csvChecksum = sha256Hex(csvText);
  if (csvChecksum !== manifest.checksum_sha256) {
    throw new Error("checksum_mismatch");
  }
  if (manifest.as_of !== `sha256=${csvChecksum}`) {
    throw new Error("as_of_checksum_mismatch");
  }
  const months = new Set(records.map((record) => periodMonthFromIso(record.started_at)));
  if (months.size !== 1) {
    throw new Error("multi_month_fixture_not_allowed");
  }
  for (const record of records) {
    if (!Number.isFinite(record.duration_s) || record.duration_s < 0) {
      throw new Error("invalid_duration");
    }
  }
  return Array.from(months)[0] ?? "";
}

function aggregateByStation(
  records: TripRecord[],
  kind: "start_station_id" | "end_station_id"
): Map<string, FlowAggregate> {
  const map = new Map<string, FlowAggregate>();
  for (const record of records) {
    const stationKey = record[kind];
    const periodMonth = periodMonthFromIso(record.started_at);
    const key = `${periodMonth}::${stationKey}`;
    const current = map.get(key) ?? {
      station_key: stationKey,
      period_month: periodMonth,
      trips: 0,
      total_duration_s: 0,
      member_trips: 0,
      casual_trips: 0,
    };
    current.trips += 1;
    current.total_duration_s += record.duration_s;
    if (record.member_type === "member") {
      current.member_trips += 1;
    } else {
      current.casual_trips += 1;
    }
    map.set(key, current);
  }
  return map;
}

async function upsertTripsDataset(
  db: SqlExecutor,
  systemId: string,
  manifest: TripsBaselineManifest,
  periodMonth: string
): Promise<void> {
  await db.query(
    `INSERT INTO datasets (dataset_id, note)
     VALUES ($1, $2)
     ON CONFLICT (dataset_id) DO NOTHING`,
    [manifest.dataset_id, "trips baseline dataset"]
  );

  await db.query(
    `INSERT INTO dataset_watermarks (system_id, dataset_id, as_of_text, max_observed_at, updated_at)
     VALUES ($1, $2, $3, NULL, NOW())
     ON CONFLICT (system_id, dataset_id)
     DO UPDATE SET as_of_text = EXCLUDED.as_of_text, updated_at = NOW()`,
    [systemId, manifest.dataset_id, manifest.as_of]
  );

  await db.query(
    `INSERT INTO trips_baseline_datasets (
       dataset_id,
       system_id,
       period_month,
       as_of_text,
       checksum_sha256,
       row_count,
       schema_version,
       source
     ) VALUES ($1, $2, $3::date, $4, $5, $6, $7, $8)
     ON CONFLICT (dataset_id)
     DO UPDATE SET
       system_id = EXCLUDED.system_id,
       period_month = EXCLUDED.period_month,
       as_of_text = EXCLUDED.as_of_text,
       checksum_sha256 = EXCLUDED.checksum_sha256,
       row_count = EXCLUDED.row_count,
       schema_version = EXCLUDED.schema_version,
       source = EXCLUDED.source`,
    [
      manifest.dataset_id,
      systemId,
      periodMonth,
      manifest.as_of,
      manifest.checksum_sha256,
      manifest.row_count,
      manifest.schema_version,
      manifest.source,
    ]
  );
}

async function replaceTripsRows(
  db: SqlExecutor,
  datasetId: string,
  records: TripRecord[]
): Promise<void> {
  for (const record of records) {
    await db.query(
      `INSERT INTO trips_baseline_rows (
         dataset_id,
         trip_id,
         started_at,
         ended_at,
         start_station_key,
         end_station_key,
         member_type,
         duration_s
       ) VALUES ($1, $2, $3::timestamptz, $4::timestamptz, $5, $6, $7, $8)
       ON CONFLICT (dataset_id, trip_id)
       DO UPDATE SET
         started_at = EXCLUDED.started_at,
         ended_at = EXCLUDED.ended_at,
         start_station_key = EXCLUDED.start_station_key,
         end_station_key = EXCLUDED.end_station_key,
         member_type = EXCLUDED.member_type,
         duration_s = EXCLUDED.duration_s`,
      [
        datasetId,
        record.trip_id,
        record.started_at,
        record.ended_at,
        record.start_station_id,
        record.end_station_id,
        record.member_type,
        record.duration_s,
      ]
    );
  }
}

async function replaceFlowAggregates(
  db: SqlExecutor,
  params: {
    system_id: string;
    dataset_id: string;
    period_month: string;
    outflows: Map<string, FlowAggregate>;
    inflows: Map<string, FlowAggregate>;
  }
): Promise<void> {
  for (const row of params.outflows.values()) {
    await db.query(
      `INSERT INTO station_outflows_monthly (
         system_id,
         dataset_id,
         period_month,
         station_key,
         trips_out,
         total_duration_s,
         member_trips,
         casual_trips
       ) VALUES ($1, $2, $3::date, $4, $5, $6, $7, $8)
       ON CONFLICT (dataset_id, period_month, station_key)
       DO UPDATE SET
         system_id = EXCLUDED.system_id,
         trips_out = EXCLUDED.trips_out,
         total_duration_s = EXCLUDED.total_duration_s,
         member_trips = EXCLUDED.member_trips,
         casual_trips = EXCLUDED.casual_trips,
         updated_at = NOW()`,
      [
        params.system_id,
        params.dataset_id,
        row.period_month,
        row.station_key,
        row.trips,
        row.total_duration_s,
        row.member_trips,
        row.casual_trips,
      ]
    );
  }

  for (const row of params.inflows.values()) {
    await db.query(
      `INSERT INTO station_inflows_monthly (
         system_id,
         dataset_id,
         period_month,
         station_key,
         trips_in,
         total_duration_s,
         member_trips,
         casual_trips
       ) VALUES ($1, $2, $3::date, $4, $5, $6, $7, $8)
       ON CONFLICT (dataset_id, period_month, station_key)
       DO UPDATE SET
         system_id = EXCLUDED.system_id,
         trips_in = EXCLUDED.trips_in,
         total_duration_s = EXCLUDED.total_duration_s,
         member_trips = EXCLUDED.member_trips,
         casual_trips = EXCLUDED.casual_trips,
         updated_at = NOW()`,
      [
        params.system_id,
        params.dataset_id,
        row.period_month,
        row.station_key,
        row.trips,
        row.total_duration_s,
        row.member_trips,
        row.casual_trips,
      ]
    );
  }
}

export async function ingestTripsBaselineFromManifest(params: {
  db: SqlExecutor;
  system_id: string;
  manifest_path: string;
  logger?: (event: string, details: Record<string, unknown>) => void;
}): Promise<TripsBaselineIngestResult> {
  const logger = params.logger ?? ((event, details) => console.info(JSON.stringify({ event, ...details })));
  const manifestPath = path.resolve(process.cwd(), params.manifest_path);
  const manifest = JSON.parse(await fs.readFile(manifestPath, "utf-8")) as TripsBaselineManifest;
  const fromManifestDir = path.resolve(path.dirname(manifestPath), manifest.filename);
  const csvPath = await fs
    .access(fromManifestDir)
    .then(() => fromManifestDir)
    .catch(() => path.resolve(process.cwd(), manifest.filename));
  const csv = await fs.readFile(csvPath, "utf-8");
  const records = parseCsv(csv);
  const periodMonth = validateQualityGate(records, manifest, csv);

  logger("trips_baseline_selected", {
    system_id: params.system_id,
    dataset_id: manifest.dataset_id,
    period_month: periodMonth,
    as_of: manifest.as_of,
    row_count: records.length,
  });

  const outflows = aggregateByStation(records, "start_station_id");
  const inflows = aggregateByStation(records, "end_station_id");

  await upsertTripsDataset(params.db, params.system_id, manifest, periodMonth);
  await replaceTripsRows(params.db, manifest.dataset_id, records);
  await replaceFlowAggregates(params.db, {
    system_id: params.system_id,
    dataset_id: manifest.dataset_id,
    period_month: periodMonth,
    outflows,
    inflows,
  });

  logger("trips_baseline_aggregates_ready", {
    system_id: params.system_id,
    dataset_id: manifest.dataset_id,
    period_month: periodMonth,
    outflow_rows: outflows.size,
    inflow_rows: inflows.size,
  });

  return {
    dataset_id: manifest.dataset_id,
    period_month: periodMonth,
    row_count: records.length,
    station_outflows_rows: outflows.size,
    station_inflows_rows: inflows.size,
  };
}

export function aggregateTripsForTest(records: TripRecord[]): {
  period_month: string;
  outflows: Map<string, FlowAggregate>;
  inflows: Map<string, FlowAggregate>;
} {
  const csvBody = records.map((record) => {
    const fields = [
      record.trip_id,
      record.started_at,
      record.ended_at,
      record.start_station_id,
      record.end_station_id,
      record.member_type,
      String(record.duration_s),
    ];
    return fields.join(",");
  }).join("\n");
  const csvText =
    "trip_id,started_at,ended_at,start_station_id,end_station_id,member_type,duration_s\n" +
    csvBody;
  const checksum = sha256Hex(csvText);
  const periodMonth = validateQualityGate(records, {
    dataset_id: "test",
    as_of: `sha256=${checksum}`,
    checksum_sha256: checksum,
    filename: "",
    row_count: records.length,
    schema_version: "trips.v1",
    source: "test",
  }, csvText);
  return {
    period_month: periodMonth,
    outflows: aggregateByStation(records, "start_station_id"),
    inflows: aggregateByStation(records, "end_station_id"),
  };
}
