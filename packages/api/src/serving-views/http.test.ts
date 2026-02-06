import { describe, expect, it } from "bun:test";

import { buildTimeEndpointResponse } from "./http";
import type { DatasetWatermark } from "./types";

describe("buildTimeEndpointResponse", () => {
  it("returns server time, dataset summaries, and recommended_live_sv", async () => {
    const watermarks: DatasetWatermark[] = [
      {
        system_id: "citibike-nyc",
        dataset_id: "gbfs.station_status",
        as_of_ts: new Date("2026-02-06T18:40:00Z"),
        max_observed_at: new Date("2026-02-06T18:39:20Z"),
      },
      {
        system_id: "citibike-nyc",
        dataset_id: "trips.monthly",
        as_of_text: "sha256=abc123",
        max_observed_at: new Date("2026-02-06T18:00:00Z"),
      },
    ];

    const out = await buildTimeEndpointResponse({
      servingViews: {
        async mintLiveToken() {
          return {
            ok: true as const,
            sv: "sv1.fake",
            view_spec_sha256: "deadbeef",
            view_id: 42,
          };
        },
      },
      viewStore: {
        async listWatermarks() {
          return watermarks;
        },
      },
      system_id: "citibike-nyc",
      view_version: "sv.v1",
      ttl_seconds: 120,
      tile_schema_version: "tile.v1",
      severity_version: "sev.v1",
      severity_spec_sha256: "abcd",
      required_datasets: ["gbfs.station_status"],
      optional_datasets: ["trips.monthly"],
      clock: () => new Date("2026-02-06T18:40:20Z"),
    });

    expect(out.ok).toBe(true);
    if (!out.ok) {
      return;
    }

    expect(out.status).toBe(200);
    expect(out.body.server_now).toBe("2026-02-06T18:40:20.000Z");
    expect(out.body.recommended_live_sv).toBe("sv1.fake");
    expect(out.body.view_id).toBe(42);
    expect(out.body.datasets.length).toBe(2);
    expect(out.body.datasets[0]?.dataset_id).toBe("gbfs.station_status");
    expect(out.body.datasets[0]?.ingest_lag_s).toBe(60);
    expect(out.body.datasets[1]?.as_of).toBe("sha256=abc123");
  });

  it("returns 500 when required watermark is missing", async () => {
    const out = await buildTimeEndpointResponse({
      servingViews: {
        async mintLiveToken() {
          throw new Error("mint should not be called");
        },
      },
      viewStore: {
        async listWatermarks() {
          return [];
        },
      },
      system_id: "citibike-nyc",
      view_version: "sv.v1",
      ttl_seconds: 120,
      tile_schema_version: "tile.v1",
      severity_version: "sev.v1",
      severity_spec_sha256: "abcd",
      required_datasets: ["gbfs.station_status"],
      clock: () => new Date("2026-02-06T18:40:20Z"),
    });

    expect(out.ok).toBe(false);
    if (out.ok) {
      return;
    }
    expect(out.status).toBe(500);
    expect(out.body.error.code).toBe("missing_watermark");
  });

  it("propagates mint errors", async () => {
    const out = await buildTimeEndpointResponse({
      servingViews: {
        async mintLiveToken() {
          return {
            ok: false as const,
            status: 400,
            code: "allowlist_violation",
            message: "Unknown system_id",
          };
        },
      },
      viewStore: {
        async listWatermarks() {
          return [
            {
              system_id: "citibike-nyc",
              dataset_id: "gbfs.station_status",
              as_of_ts: new Date("2026-02-06T18:40:00Z"),
            },
          ];
        },
      },
      system_id: "citibike-nyc",
      view_version: "sv.v1",
      ttl_seconds: 120,
      tile_schema_version: "tile.v1",
      severity_version: "sev.v1",
      severity_spec_sha256: "abcd",
      required_datasets: ["gbfs.station_status"],
      clock: () => new Date("2026-02-06T18:40:20Z"),
    });

    expect(out.ok).toBe(false);
    if (out.ok) {
      return;
    }
    expect(out.status).toBe(400);
    expect(out.body.error.code).toBe("allowlist_violation");
  });
});
