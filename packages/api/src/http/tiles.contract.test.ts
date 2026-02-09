import { describe, expect, it } from "bun:test";
import { createHash } from "node:crypto";

import { createCompositeTilesRouteHandler } from "./tiles";
import { buildCompositeTileSql } from "../tiles/composite";

type TileContractFixture = {
  tile_schema_version: string;
  layers: string[];
  required_properties: Record<string, string[]>;
};

describe("tile contract fixtures", () => {
  it("matches fixture checksum manifest", async () => {
    const fixturePath = "fixtures/tiles/composite_tile.contract.json";
    const manifestPath = "fixtures/tiles/composite_tile.manifest.json";
    const fixtureText = await Bun.file(fixturePath).text();
    const manifest = (await Bun.file(manifestPath).json()) as {
      fixtures: Array<{ filename: string; checksum_sha256: string }>;
    };
    const entry = manifest.fixtures.find((item) => item.filename === fixturePath);
    expect(entry).toBeTruthy();
    const checksum = createHash("sha256").update(fixtureText).digest("hex");
    expect(checksum).toBe(entry?.checksum_sha256);
  });

  it("keeps required composite tile properties represented in canonical SQL", async () => {
    const fixture = (await Bun.file("fixtures/tiles/composite_tile.contract.json").json()) as TileContractFixture;
    const plan = buildCompositeTileSql({
      system_id: "citibike-nyc",
      t_bucket_epoch_s: 1738872000,
      severity_version: "sev.v1",
      pressure_source: "live_proxy",
      include_inv: true,
      include_sev: true,
      include_press: true,
      include_epi: true,
      include_optional_props: true,
      compare_mode: "off",
      z: 12,
      x: 1200,
      y: 1530,
      max_features: 1500,
      mvt_extent: 4096,
      mvt_buffer: 64,
    });

    const sql = plan.text;
    expect(fixture.tile_schema_version).toBe("tile.v1");
    expect(fixture.layers).toEqual(["inv", "sev", "press", "epi"]);

    // inv required properties
    expect(fixture.required_properties.inv).toEqual(
      expect.arrayContaining([
        "station_key",
        "bikes_available",
        "docks_available",
        "observation_ts_bucket",
        "bucket_quality",
      ])
    );
    expect(sql).toContain("bs.station_key");
    expect(sql).toContain("AS bikes_available");
    expect(sql).toContain("AS docks_available");
    expect(sql).toContain("AS observation_ts_bucket");
    expect(sql).toContain("AS bucket_quality");

    // sev required properties
    expect(fixture.required_properties.sev).toEqual(
      expect.arrayContaining(["station_key", "severity", "severity_version", "observation_ts_bucket"])
    );
    expect(sql).toContain("AS severity");
    expect(sql).toContain("$10::text AS severity_version");

    // press required properties
    expect(fixture.required_properties.press).toEqual(
      expect.arrayContaining(["station_key", "pressure", "observation_ts_bucket"])
    );
    expect(sql).toContain("AS pressure");

    // epi required properties
    expect(fixture.required_properties.epi).toEqual(
      expect.arrayContaining(["station_key", "episode_status", "observation_ts_bucket"])
    );
    expect(sql).toContain("'none'::text AS episode_status");
  });
});

describe("tile contract determinism", () => {
  it("uses deterministic replay cache keys for equivalent layer sets", async () => {
    const replayCache = new Map<string, { mvt: Uint8Array; feature_count: number; bytes: number; degrade_level?: number }>();
    const replayGetKeys: string[] = [];
    let storeCalls = 0;
    const handler = createCompositeTilesRouteHandler({
      tokens: {
        async validate() {
          return {
            ok: true as const,
            payload: {
              system_id: "citibike-nyc",
              view_id: 42,
              view_spec_sha256: "view-hash",
              issued_at_s: 1738872000,
              expires_at_s: 1739476800,
            },
          };
        },
      } as unknown as import("../sv/service").ServingTokenService,
      allowlist: {
        async isAllowed() {
          return true;
        },
      },
      replayCache: {
        async get(key) {
          replayGetKeys.push(key);
          return replayCache.get(key) ?? null;
        },
        async put(key, value) {
          replayCache.set(key, value);
        },
      },
      tileStore: {
        async fetchCompositeTile() {
          storeCalls += 1;
          return {
            ok: true as const,
            mvt: new Uint8Array([1, 2, 3]),
            feature_count: 3,
            bytes: 3,
          };
        },
      },
      cache: {
        max_age_s: 30,
        s_maxage_s: 120,
        stale_while_revalidate_s: 15,
        replay_max_age_s: 600,
        replay_s_maxage_s: 3600,
        replay_stale_while_revalidate_s: 60,
        replay_min_ttl_s: 86400,
      },
    });

    const one = await handler(
      new Request(
        "https://example.test/api/tiles/composite/12/1200/1530.mvt?v=1&sv=abc&tile_schema=tile.v1&severity_version=sev.v1&layers=sev,inv&T_bucket=1738872000"
      )
    );
    const two = await handler(
      new Request(
        "https://example.test/api/tiles/composite/12/1200/1530.mvt?v=1&sv=abc&tile_schema=tile.v1&severity_version=sev.v1&layers=inv,sev&T_bucket=1738872000"
      )
    );

    expect(one.status).toBe(200);
    expect(two.status).toBe(200);
    expect(replayGetKeys.length).toBe(2);
    expect(replayGetKeys[0]).toBe(replayGetKeys[1]);
    expect(storeCalls).toBe(1);
    expect(two.headers.get("X-Replay-Tile-Source")).toBe("write-through-cache");
  });

  it("changes replay cache key when compare dimensions change", async () => {
    const replayGetKeys: string[] = [];
    const handler = createCompositeTilesRouteHandler({
      tokens: {
        async validate() {
          return {
            ok: true as const,
            payload: {
              system_id: "citibike-nyc",
              view_id: 42,
              view_spec_sha256: "view-hash",
              issued_at_s: 1738872000,
              expires_at_s: 1739476800,
            },
          };
        },
      } as unknown as import("../sv/service").ServingTokenService,
      allowlist: {
        async isAllowed() {
          return true;
        },
      },
      replayCache: {
        async get(key) {
          replayGetKeys.push(key);
          return null;
        },
        async put() {},
      },
      tileStore: {
        async fetchCompositeTile() {
          return {
            ok: true as const,
            mvt: new Uint8Array([1]),
            feature_count: 1,
            bytes: 1,
          };
        },
      },
      cache: {
        max_age_s: 30,
        s_maxage_s: 120,
        stale_while_revalidate_s: 15,
        replay_max_age_s: 600,
        replay_s_maxage_s: 3600,
        replay_stale_while_revalidate_s: 60,
        replay_min_ttl_s: 86400,
      },
    });

    const one = await handler(
      new Request(
        "https://example.test/api/tiles/composite/12/1200/1530.mvt?v=1&sv=abc&tile_schema=tile.v1&severity_version=sev.v1&layers=inv,sev&T_bucket=1738872000&T2_bucket=1738871700&compare_mode=split"
      )
    );
    const two = await handler(
      new Request(
        "https://example.test/api/tiles/composite/12/1200/1530.mvt?v=1&sv=abc&tile_schema=tile.v1&severity_version=sev.v1&layers=inv,sev&T_bucket=1738872000&T2_bucket=1738871400&compare_mode=split"
      )
    );

    expect(one.status).toBe(200);
    expect(two.status).toBe(200);
    expect(replayGetKeys.length).toBe(2);
    expect(replayGetKeys[0]).not.toBe(replayGetKeys[1]);
  });
});
