import type { SqlExecutor } from "../db/types";
import type { AllowlistQuery, AllowlistStore } from "./types";

type AllowRow = {
  allow_id: number;
};

export class PgAllowlistStore implements AllowlistStore {
  private readonly db: SqlExecutor;

  constructor(db: SqlExecutor) {
    this.db = db;
  }

  async isAllowed(query: AllowlistQuery): Promise<boolean> {
    // Allow either a global entry (system_id IS NULL) or a system-scoped one.
    // If caller doesn't provide system_id, only global entries are eligible.
    const rows = await this.db.query<AllowRow>(
      `SELECT allow_id
       FROM namespace_allowlist
       WHERE kind = $1
         AND value = $2
         AND disabled_at IS NULL
         AND (
           ($3::text IS NULL AND system_id IS NULL)
           OR ($3::text IS NOT NULL AND (system_id IS NULL OR system_id = $3))
         )
       LIMIT 1`,
      [query.kind, query.value, query.system_id ?? null]
    );
    return rows.rows.length > 0;
  }
}
