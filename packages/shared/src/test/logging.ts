export type TestLogLevel = "debug" | "info" | "warn" | "error";

export type TestLogContext = {
  systemId?: string;
  sv?: string;
  tBucket?: string;
  tileSchema?: string;
  cacheKey?: string;
  requestId?: string;
};

export type TestLogEntry = {
  ts: string;
  level: TestLogLevel;
  event: string;
  context?: TestLogContext;
  data?: Record<string, unknown>;
};

export type TestLogger = {
  entries: TestLogEntry[];
  log: (level: TestLogLevel, event: string, data?: Record<string, unknown>) => void;
  debug: (event: string, data?: Record<string, unknown>) => void;
  info: (event: string, data?: Record<string, unknown>) => void;
  warn: (event: string, data?: Record<string, unknown>) => void;
  error: (event: string, data?: Record<string, unknown>) => void;
  withContext: (context: TestLogContext) => TestLogger;
  toJsonLines: () => string;
  clear: () => void;
};

export type TestLoggerOptions = {
  defaultContext?: TestLogContext;
  clock?: () => string;
};

export function createTestLogger(options: TestLoggerOptions = {}): TestLogger {
  const entries: TestLogEntry[] = [];
  const clock = options.clock ?? (() => new Date().toISOString());
  const baseContext = options.defaultContext ?? {};
  return buildLogger(entries, clock, baseContext);
}

function buildLogger(
  entries: TestLogEntry[],
  clock: () => string,
  baseContext: TestLogContext,
): TestLogger {
  const log = (level: TestLogLevel, event: string, data?: Record<string, unknown>): void => {
    entries.push({
      ts: clock(),
      level,
      event,
      context: baseContext,
      data,
    });
  };

  return {
    entries,
    log,
    debug: (event, data) => log("debug", event, data),
    info: (event, data) => log("info", event, data),
    warn: (event, data) => log("warn", event, data),
    error: (event, data) => log("error", event, data),
    withContext: (context) => buildLogger(entries, clock, { ...baseContext, ...context }),
    toJsonLines: () => entries.map((entry) => stableStringify(entry)).join("\n"),
    clear: () => {
      entries.length = 0;
    },
  };
}

function stableStringify(value: unknown): string {
  return JSON.stringify(sortValue(value));
}

function sortValue(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map((item) => sortValue(item));
  }
  if (value && typeof value === "object") {
    const record = value as Record<string, unknown>;
    return Object.keys(record)
      .sort()
      .reduce<Record<string, unknown>>((acc, key) => {
        acc[key] = sortValue(record[key]);
        return acc;
      }, {});
  }
  return value;
}
