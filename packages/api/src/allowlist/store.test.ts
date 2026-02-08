import { describe, expect, it } from "bun:test";

import type { SqlQueryResult } from "../db/types";
import { PgAllowlistStore } from "./store";

class FakeDb {
  calls: Array<{ text: string; params: Array<unknown> }> = [];
  rows: Array<Record<string, unknown>> = [];

  async query<Row extends Record<string, unknown>>(
    text: string,
    params: Array<unknown> = []
  ): Promise<SqlQueryResult<Row>> {
    this.calls.push({ text: text.trim(), params });
    return { rows: this.rows as Row[] };
  }
}

describe("PgAllowlistStore", () => {
  it("checks allowlist membership with optional system scope", async () => {
    const db = new FakeDb();
    db.rows = [{ allow_id: 1 }];
    const store = new PgAllowlistStore(db);

    const allowed = await store.isAllowed({
      kind: "tile_schema",
      value: "tile.v1",
      system_id: "citibike-nyc",
    });
    expect(allowed).toBe(true);
    expect(db.calls[0]?.params).toEqual(["tile_schema", "tile.v1", "citibike-nyc"]);
  });

  it("lists sorted allowlisted values for a kind", async () => {
    const db = new FakeDb();
    db.rows = [{ value: "inv,press,sev" }, { value: "inv,sev" }];
    const store = new PgAllowlistStore(db);

    const values = await store.listAllowedValues({
      kind: "layers_set",
      system_id: "citibike-nyc",
    });
    expect(values).toEqual(["inv,press,sev", "inv,sev"]);
    expect(db.calls[0]?.params).toEqual(["layers_set", "citibike-nyc"]);
  });
});
