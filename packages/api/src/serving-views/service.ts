import type { AllowlistStore } from "../allowlist/types";
import { enforceAllowlist } from "../allowlist/enforce";
import type { ServingTokenService } from "../sv/service";
import type { ServingTokenStore } from "../sv/types";
import { sha256Hex } from "../sv/encoding";
import type { PgServingViewStore } from "./store";
import type { DatasetId, ServingViewSpec, ServingViewVersion } from "./types";
import { normalizeForJson, stableStringify } from "./stable_json";

export class ServingViewService {
  private readonly views: PgServingViewStore;
  private readonly allowlist: AllowlistStore;
  private readonly tokens: ServingTokenService;
  private readonly tokenStore: ServingTokenStore;

  constructor(params: {
    views: PgServingViewStore;
    allowlist: AllowlistStore;
    tokens: ServingTokenService;
    tokenStore: ServingTokenStore;
  }) {
    this.views = params.views;
    this.allowlist = params.allowlist;
    this.tokens = params.tokens;
    this.tokenStore = params.tokenStore;
  }

  async mintLiveToken(params: {
    system_id: string;
    view_version: ServingViewVersion;
    ttl_seconds: number;
    tile_schema_version: string;
    severity_version: string;
    severity_spec_sha256: string;
    required_datasets: DatasetId[];
    optional_datasets?: DatasetId[];
  }): Promise<
    | { ok: true; sv: string; view_spec_sha256: string; view_id: number }
    | { ok: false; status: 400 | 500; code: string; message: string }
  > {
    const allow = await enforceAllowlist(
      this.allowlist,
      [
        { kind: "system_id", value: params.system_id },
        { kind: "tile_schema", value: params.tile_schema_version, system_id: params.system_id },
        { kind: "severity_version", value: params.severity_version, system_id: params.system_id },
      ],
      { path: "/api/time" }
    );
    if (!allow.ok) {
      return { ok: false, status: 400, code: allow.code, message: allow.message };
    }

    const datasets: ServingViewSpec["datasets"] = {};
    for (const datasetId of params.required_datasets) {
      await this.views.ensureDataset(datasetId);
      const wm = await this.views.getWatermark(params.system_id, datasetId);
      if (!wm) {
        await this.tokenStore.saveAuditEvent({
          event_type: "mint",
          event_ts: new Date(),
          system_id: params.system_id,
          reason_code: "missing_watermark",
          details: { dataset_id: datasetId },
        });
        return {
          ok: false,
          status: 500,
          code: "missing_watermark",
          message: `Missing dataset watermark: ${datasetId}`,
        };
      }
      const entry: { as_of_ts?: string; as_of_text?: string } = {};
      if (wm.as_of_ts) entry.as_of_ts = wm.as_of_ts.toISOString();
      if (wm.as_of_text) entry.as_of_text = wm.as_of_text;
      datasets[datasetId] = entry;
    }

    for (const datasetId of params.optional_datasets ?? []) {
      await this.views.ensureDataset(datasetId);
      const wm = await this.views.getWatermark(params.system_id, datasetId);
      if (wm) {
        const entry: { as_of_ts?: string; as_of_text?: string } = {};
        if (wm.as_of_ts) entry.as_of_ts = wm.as_of_ts.toISOString();
        if (wm.as_of_text) entry.as_of_text = wm.as_of_text;
        datasets[datasetId] = entry;
      }
    }

    const spec: ServingViewSpec = {
      system_id: params.system_id,
      datasets,
      severity_version: params.severity_version,
      severity_spec_sha256: params.severity_spec_sha256,
      tile_schema_version: params.tile_schema_version,
    };

    // Ensure the object we hash matches what we persist (no undefined fields).
    const normalizedSpec = normalizeForJson(spec) as ServingViewSpec;
    const specSha = sha256Hex(stableStringify(normalizedSpec));
    const view = await this.views.upsertServingView({
      system_id: params.system_id,
      view_version: params.view_version,
      view_spec_sha256: specSha,
      view_spec: normalizedSpec,
    });

    const minted = await this.tokens.mint({
      systemId: params.system_id,
      viewId: view.view_id,
      viewSpecSha256: specSha,
      ttlSeconds: params.ttl_seconds,
    });
    if (!minted.ok) {
      return { ok: false, status: 500, code: minted.reason, message: "sv mint failed" };
    }

    return { ok: true, sv: minted.token, view_spec_sha256: specSha, view_id: view.view_id };
  }
}
