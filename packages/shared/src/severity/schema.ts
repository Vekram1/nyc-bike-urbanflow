export type SeveritySpecV1 = {
  version: "sev.v1";
  bucket_seconds: number;
  formula: {
    type: "empty_or_full_flag";
    empty_weight: number;
    full_weight: number;
    clamp_min: number;
    clamp_max: number;
  };
  missing_data: {
    allowed_bucket_quality: Array<"ok" | "degraded" | "blocked">;
    on_missing: "zero";
  };
  components: Array<"empty_flag" | "full_flag" | "capacity">;
};

export type SeveritySpecValidationResult =
  | { ok: true; value: SeveritySpecV1 }
  | { ok: false; errors: string[] };

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function validateSeveritySpecV1(input: unknown): SeveritySpecValidationResult {
  if (!isRecord(input)) {
    return { ok: false, errors: ["spec must be an object"] };
  }

  const errors: string[] = [];
  const version = input.version;
  const bucketSeconds = input.bucket_seconds;
  const formula = input.formula;
  const missingData = input.missing_data;
  const components = input.components;

  if (version !== "sev.v1") {
    errors.push("version must be sev.v1");
  }
  if (!Number.isInteger(bucketSeconds) || (bucketSeconds as number) <= 0) {
    errors.push("bucket_seconds must be a positive integer");
  }

  if (!isRecord(formula)) {
    errors.push("formula must be an object");
  } else {
    if (formula.type !== "empty_or_full_flag") {
      errors.push("formula.type must be empty_or_full_flag");
    }
    const ew = formula.empty_weight;
    const fw = formula.full_weight;
    const cmin = formula.clamp_min;
    const cmax = formula.clamp_max;
    if (typeof ew !== "number" || ew < 0) {
      errors.push("formula.empty_weight must be a non-negative number");
    }
    if (typeof fw !== "number" || fw < 0) {
      errors.push("formula.full_weight must be a non-negative number");
    }
    if (typeof cmin !== "number" || typeof cmax !== "number" || cmin > cmax) {
      errors.push("formula.clamp_min/clamp_max must be numbers with clamp_min <= clamp_max");
    }
  }

  if (!isRecord(missingData)) {
    errors.push("missing_data must be an object");
  } else {
    const allowed = missingData.allowed_bucket_quality;
    const onMissing = missingData.on_missing;
    if (!Array.isArray(allowed) || allowed.length === 0) {
      errors.push("missing_data.allowed_bucket_quality must be a non-empty array");
    } else {
      for (const entry of allowed) {
        if (entry !== "ok" && entry !== "degraded" && entry !== "blocked") {
          errors.push("missing_data.allowed_bucket_quality contains invalid value");
          break;
        }
      }
    }
    if (onMissing !== "zero") {
      errors.push("missing_data.on_missing must be zero");
    }
  }

  if (!Array.isArray(components) || components.length === 0) {
    errors.push("components must be a non-empty array");
  }

  if (errors.length > 0) {
    return { ok: false, errors };
  }

  return { ok: true, value: input as SeveritySpecV1 };
}
