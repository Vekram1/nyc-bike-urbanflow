# AGENTS.md — UrbanFlow Twin

## What this file is (read once)
This file is the operating protocol for coding agents working in this repo.
PLAN.md is the product/architecture specification. If AGENTS.md conflicts with PLAN.md, STOP and reconcile via a doc diff.

## 60-second contract summary (do not improvise)
Core invariants from PLAN.md that MUST be preserved:
- Tiles-first: the data plane is `/api/tiles/*` and must degrade first under load.
- Reproducibility: public clients do not request raw `as_of`; they use server-minted `sv` serving view tokens.
- Bounded keyspace: system_id / versions / layers must be allowlisted; reject unknown params with 400 (not cached).
- Determinism: policy + severity + tile schemas are versioned; any semantic change increments versions/namespaces.
- Profile A default: cost-first (<$50/yr). Avoid Profile B infra unless the user explicitly opts in.
- Map UX: MapShell mounts once per session; never remount the Mapbox map.
- Inspect UX: station click freezes playback (no tile URL mutations) until drawer closes.

## When you MUST stop and ask the user
- Adding ANY dependency (runtime or dev) or changing bundler/build stack
- Introducing Profile B infra (Timescale, Redis, dedicated queue/workers, replicas)
- Changing any versioned contract: sv token claims, allowlist dimensions, tile_schema_version, severity_version, policy_version
- Destructive actions (see safety invariant), including DB drops/truncates or deleting raw archives/artifacts

## BEFORE ANYTHING ELSE (Beads bootstrap)

- Run: `bd onboard` and follow its instructions.
- If Beads is not initialized in this repo, a human should run: `bd init` (or `bd init --stealth` for local-only usage).

## Issue Tracking

This project uses **bd (beads)** for issue tracking.
Run `bd prime` for workflow context, or install hooks (`bd hooks install`) for auto-injection.

**Quick reference:**
- `bd ready` - Find unblocked work
- `bd create "Title" --type task --priority 2` - Create issue
- `bd close <id>` - Complete work
- `bd sync` - Sync with git (run at session end)

For full workflow details: `bd prime`

## RULE 1 — ABSOLUTE SAFETY INVARIANT (DO NOT VIOLATE)

You may NOT delete, overwrite, or irreversibly modify files/data unless the user provides the exact command and explicit approval in the same session.
This includes files you just created. If you think something should be removed, STOP and ask.

## Irreversible git & filesystem actions (forbidden without exact user command)

Examples (non-exhaustive):
- `rm -rf`, `rm -r`, `unlink`
- `git reset --hard`, `git clean -fd`, `git checkout -- <path>`, `git restore --source`
- `git push --force` / `--force-with-lease`
- Overwrite redirection: `>` / `2>` / `tee` without `-a` when it can clobber files
- In-place edits like `sed -i` when output isn’t reviewed first

Also forbidden without exact user command (data-plane truth):
- DB-destructive SQL: `DROP TABLE`, `TRUNCATE`, `DELETE FROM` on large tables, or any down-migration
- Deleting archives/artifacts: removing `data/`, `artifacts/`, `generated/`, object-store buckets/keys
- Cleanup scripts that delete manifests, tilepacks, or raw objects

Rules:
1. If not 100% sure what a command will affect, do not propose or run it—ask.
2. Prefer safe alternatives: `git status`, `git diff`, `git stash push -u`, copy/backup.
3. After user approval: restate the command verbatim + list affected paths + wait for confirmation.
4. If a destructive command is executed, record in the response:
   - Exact user text authorizing it
   - Exact command run
   - When it was run (timestamp)
If this audit trail is missing, treat the operation as not performed.

## Tooling rules

- Use Bun for all JS/TS tasks (`bun install`, `bun run ...`). Do not use npm/yarn/pnpm.
- Lockfiles: only `bun.lock`. Do not introduce `package-lock.json`, `yarn.lock`, or `pnpm-lock.yaml`.
- Do not add new dependencies (runtime or dev) without explicit user approval.
- Prefer small, explicit edits; avoid bulk-modifying scripts or large refactors unless requested.
- Do not edit generated outputs by hand. Generate artifacts via the documented commands.

## Generated files (never edit manually)

If we introduce generated artifacts (tilesets, manifests, indexes, derived outputs):
- Put them under a clearly named directory (e.g., `generated/` or `artifacts/`).
- Store the generator command adjacent (README or script).
- Treat generated outputs as immutable: regenerate, don’t patch.

## Database + migrations discipline

- Any schema change must ship as a migration (no manual tweaks).
- Migrations must be deterministic, reviewable, and safe to apply in dev.
- Prefer expand/contract patterns for breaking changes.
- Link migrations to a beads issue ID where practical.

## Collaboration + tracking tools

- Beads is the single source of truth for work tracking.
- No work expected to take > ~2 minutes without a Beads issue (create one first).
- Use `bd` for create/update/close. Never edit Beads JSONL directly (see JSONL section below).
- If code changes, `.beads/` must be updated and committed in the same logical change set.

### Beads workflow (minimum standard)
1. `bd ready --json` → pick an unblocked issue
   - If nothing is ready: `bd blocked` and inspect blockers before creating new work.
2. Claim atomically (multi-agent safe): `bd update <id> --claim`
3. Implement with small diffs
   - In the Beads issue description, include:
     - PLAN.md section(s) that govern this change
     - contract surface touched (tiles/severity/policy/sv/control plane)
     - expected cache-key impact (yes/no)
4. If new work is discovered:
   - `bd create "..." --deps discovered-from:<parent>` (or mention parent in description)
5. When done:
   - run quality gates (see below)
   - `bd close <id> --reason "Completed" --json`
6. Sync + commit:
   - `bd sync --flush-only` (or `bd sync` depending on repo config; see Sync rules)
   - `git add .beads/` (and any changed code)

### Definition of done (DoD)
- Tests/linters/build pass for affected package(s)
- No new TODO trackers introduced
- Docs/PLAN updated if behavior or API changed
- If a versioned contract changed (tiles/severity/policy/sv):
  - version bump applied
  - allowlist updated
  - fixtures + contract tests updated with reviewable diffs
- `.beads/` synced and committed if any code changed

### Commit hygiene (recommended)
- When making commits tied to an issue, include the Beads ID in the commit message (e.g., "Fix tile cache stampede (bd-a1b2c3)").

## bv protocol (robot-only)

- Start-of-session (or when unsure what to do): `bv --robot-triage`
- If you need parallel tracks / dependency-aware plan: `bv --robot-plan`
- If you suspect cycles / priority issues: `bv --robot-insights` or `bv --robot-priority`

Rules:
- Use ONLY `--robot-*` flags (bare `bv` is forbidden).
- Treat bv output as authoritative for prioritization/triage only.
  Architecture/spec questions are governed by PLAN.md.
- If bv metrics are `approx|skipped`, say so and fall back to beads readiness + human judgment.

## MCP Agent Mail — coordination + file reservations (mandatory in multi-agent work)

Principles:
- Use Agent Mail threads keyed to Beads IDs (e.g., `bd-a1b2c3`) for durable coordination.
- Before editing files that another agent might touch, reserve them.

Minimum workflow:
1. Ensure project/agent registration (once per environment)
2. Create/choose thread: `thread_id = <beads-id>`
3. Reserve files before edits (prefer narrow patterns)
4. Send messages with intent, files touched, expected diff surface
5. Acknowledge inbound messages promptly

Reservation rules:
- Prefer small, explicit path lists over broad globs.
- If reservation conflicts: coordinate in-thread, wait for expiry, or choose different files.
- Never bypass reservations for shared areas like `packages/shared/**`, `sql/**`, `apps/web/src/lib/**`.

## Agent roles and ownership (recommended for parallel work)
When multiple agents are active, prefer assigning one primary role per agent per Beads issue.

Roles:
- ingestion+archive: GBFS/trips fetchers, manifests, loaders, queue/DLQ
  - owns: `packages/ingest/**`, `scripts/**`, `sql/**` (migrations), `fixtures/**` (ingest fixtures)
- api-tiles: tile SQL, MVT encoding, cache headers, allowlist enforcement
  - owns: `packages/api/src/tiles/**`, `packages/shared/src/tile-schema/**`, `contracts/**` (tile contract tests)
- policy: greedy.v1 engine, specs, determinism tests, evaluation marts
  - owns: `packages/policy/**`, `packages/shared/src/policy-schema/**`, `fixtures/**` (policy fixtures)
- web-hud: MapShell, time controller, scrubber, station drawer, permalinks
  - owns: `apps/web/src/**` (especially `map/**`, `state/**`, `components/hud/**`)
- security+abuse: sv tokens, allowlists, edge rules, admin auth, CORS
  - owns: `packages/api/src/auth/**`, `packages/api/src/allowlist/**`, `packages/api/src/admin/**`

Reservation defaults (use before edits):
- ingestion+archive: reserve `packages/ingest/**`, `sql/**`, `scripts/**`
- api-tiles: reserve `packages/api/src/tiles/**`, `packages/shared/**`, `contracts/**`
- policy: reserve `packages/policy/**`, `packages/shared/**`, `fixtures/**`
- web-hud: reserve `apps/web/src/**`
- security+abuse: reserve `packages/api/src/**` (narrow paths), plus config files touched

Rule: if a change crosses roles, announce in Agent Mail thread first and split into separate Beads issues where possible.

## Stack and profiles

- Profile A (budget, default): Bun runtime API, Vite + React frontend, Postgres + PostGIS, CDN + object storage for replay tiles.
- Profile B (scale): Timescale, dedicated queues/workers, Redis for hot keys, optional read replica.

### Profile gating rules

Default to Profile A unless the user explicitly opts into Profile B.

In Profile A:
- Avoid always-on workers and managed queues unless unavoidable.
- Avoid Redis (prefer CDN caching + Postgres indexes/materialized views).
- Observability stays lightweight (structured logs + minimal metrics).

Profile B triggers (examples):
- sustained request volume where origin is bottlenecking
- queue backlog that cannot clear within target SLA
- Postgres write amplification / hypertable benefits needed
- explicit user requirement for multi-region or strict SLOs

## Versioned contract change protocol (non-negotiable)
Any change that affects public semantics or caching MUST follow this flow:

1) Identify the contract surface:
   - tiles: properties, encoding, layer composition, query shape
   - severity: formula, windows, weights, missing-data behavior
   - policy: matching/scoring/constraints/budgets/missing-data behavior
   - sv tokens: claims, TTL policy, allowlisted dimensions

2) Apply versioning rules:
   - tiles: bump `tile_schema_version` (new namespace)
   - severity: bump `severity_version` (new namespace) and persist spec hash
   - policy: bump `policy_version` and persist spec hash

3) Update allowlists:
   - ensure new versions are registered in the namespace allowlist

4) Update fixtures + contract tests:
   - add/refresh fixtures under `fixtures/` and `contracts/` so diffs are reviewable

5) Update docs:
   - PLAN.md section(s) that define the contract, plus AGENTS.md if protocol changes

Rule: if you cannot complete steps (2)-(4), STOP and ask. Do not ship partial contract changes.

## Frontend

- React + TypeScript (Vite default; Next.js optional).
- Full-bleed Mapbox GL JS with HUD overlays; never remount MapShell.

## API

- Bun HTTP service (Hono or Elysia). Tiles-first with composite tiles in Profile A.
- Control plane: `/api/time`, `/api/config`, `/api/timeline`, `/api/search`, `/api/stations/*`.
- Data plane: `/api/tiles/*` (rate-limited, cache-shielded).
- Policy plane: `/api/policy/*` (async, cacheable, budgeted separately).

## Serving tokens and namespaces

- Public endpoints use `sv` serving view tokens (opaque, signed). No raw `as_of` in requests.
- Namespace allowlist is enforced for `system_id`, `tile_schema`, `severity_version`, `policy_version`, and `layers`.
- Tile schema versioning is required (`tile_schema=tile.v1` in composite tile URLs).

## Tile performance discipline (data plane)
Tile endpoints are the highest-risk surface. Enforce PLAN.md constraints:
- Canonical SQL shape per tile type (no dynamic joins/columns based on query params).
- Spatial filter must be expressed in a GiST-friendly way using tile envelope bounds.
- MVT generation must use fixed extent/buffer and stable property sets per `tile_schema_version`.
- Hard caps:
  - max features per tile (deterministic downsampling, stable station_key ordering)
  - max bytes per tile (drop optional properties first)
- Cache correctness:
  - tile URLs must be immutable identifiers of the response: (layer + z/x/y + T_bucket + sv + severity_version + layers + tile_schema)
- Overload behavior:
  - tiles degrade before control plane; return 429 Retry-After or degrade-level responses per PLAN.md.

If a change could affect tail latency:
- add an EXPLAIN (ANALYZE, BUFFERS) note to the Beads issue
- ensure p95 budgets remain plausible (tiles DB time target <150ms).

## Data model and delivery

- Raw archive is source of truth; DB is rebuildable from manifests.
- Serving views bind all upstream watermarks (gbfs + trips + severity spec).
- Composite tiles must include Inspect Tier 0 props (station_key, bikes, docks, bucket_quality, T_bucket).

## Frontend Inspect contract (enforce Profile A behavior)
On station click, the drawer must open instantly using tile payloads only:
- name/capacity from stations tile props
- bikes/docks + bucket_quality + T_bucket from composite tile props
Do not perform an origin fetch to open Tier 1.

Tier 2 detail fetch (optional) is allowed only when:
- user explicitly requests Details, or
- drawer remains open for a debounce window and the endpoint is bounded/cached per PLAN.md.

## Policy plane

- Greedy v1 policy runs per decision bucket with explicit effort budgets.
- Policy outputs keyed by (system_id, policy_version, policy_spec_sha256, sv, decision_bucket_ts).
- Policy runs are async: return 202 on cache miss and enqueue job.

## Security and abuse controls

- Edge/CDN shields origin. Optional edge worker validates `sv` and allowlists.
- Admin endpoints require `X-Admin-Token` and strict CORS.
- Never expose raw object URLs or listings publicly.

## Threat model + abuse model (Profile A required)

Primary adversary: anonymous scraper / bot traffic targeting the data plane (tiles) to:
1) drive origin DB load (cache-miss stampede), 2) exhaust bandwidth/CPU, 3) create unbounded cache keyspace,
4) induce expensive map re-loads via SPA remounts or permalink spam.

Attack surfaces:
- Data plane: `/api/tiles/*` (high QPS; must degrade first)
- Watermark issuance: `/api/time`, `/api/timeline` (keyspace control)
- Station series endpoints (range abuse)
- Search (enumeration + spam)

Success criteria (defense):
- Unbounded keyspace is impossible (tokens + server-known namespaces only)
- Origin has a hard per-IP + global budget for uncached tile generation
- Degrade ladder is deterministic and observable (returned in `/api/time.network`)
- Public endpoints never expose raw object locations or listing primitives

Required mitigations:
- Edge rate-limits and WAF rules for `/api/tiles/*` and `/api/*` (separate policies)
- Strict CORS + deny-by-default headers (no wildcard for admin endpoints)
- Known namespace only validation for: system_id, severity_version, policy_version, layer sets

## Keyspace + cache-busting defense checklist (Profile A critical)
Before merging any change to public endpoints:
- Are all cache-key dimensions allowlisted (system_id, versions, layers, compare modes)?
- Do unknown params return 400 (not cached) rather than 404 (often cached)?
- Are `sv` tokens validated (signature, expiry, kid rotation behavior)?
- Does `/api/time` + `/api/timeline` remain the only issuer path for current sv?
- Are tile URLs still immutable identifiers of responses?
- Did you accidentally introduce a new arbitrary string param into tile URLs?

If any answer is unclear, STOP and write a short abuse impact note in the Beads issue.

## Quality gates (run before closing an issue with code changes)

Frontend (`apps/web`):
- `bun run lint`
- `bun run build`
- (if present) `bun run test`

API (`packages/api`):
- `bun run lint`
- `bun run typecheck` (or `tsc -p tsconfig.json`)
- (if present) `bun run test`

Static analysis:
- Run `ubs` on changed files when available (prefer staged file list).

## Beads maintenance (recommended)

- Run `bd doctor` periodically (and especially after Beads upgrades, sync anomalies, or filename/config drift).
- If `bd doctor` suggests fixes, follow its recommended command sequence (some repos use `bd doctor --fix`).

## Secrets handling (non-negotiable)

- Never commit secrets or tokens.
- Use env vars for runtime secrets.
- If an env var is required, add it to `.env.example` (dummy value) and document it.
- Prefer short-lived tokens where possible.

## API contract discipline

- Any API change must update shared types/schemas, fixtures, and docs/PLAN if endpoints change.
- Prefer additive changes; deprecate before removal.

## Session completion

Always end sessions with:
- Summary of changes (bullet list) with file paths
- Beads updates performed (issue IDs touched + status changes)
- Commands executed (tests/lints/builds), including failures if any

Recommended completion template (copy/paste):
- Changes:
  - <file>: <what changed + why>
- Contract surfaces touched:
  - tiles | severity | policy | sv | control plane (list)
- Version bumps:
  - tile_schema_version: <none|old->new>
  - severity_version: <none|old->new>
  - policy_version: <none|old->new>
- Cache-key / allowlist impact:
  - <none|details>
- Beads:
  - claimed: <id>
  - closed/updated: <id> (<status>)
- Commands:
  - <command> (ok/fail)

Git rules:
- Do not push unless the user explicitly asks in this session.
- Treat `bd sync` as potentially performing git operations depending on config (commit/push in some modes).
- If sync is needed but pushing is not authorized, prefer no-push variants (e.g., `bd sync --no-push`) or export-only flows as appropriate for the repo.
- If the user asks to push, follow:
  1. `git status`
  2. `bd sync --flush-only` (if beads changed)
  3. `git add ...`
  4. `git commit -m "..."`
  5. `git pull --rebase`
  6. `git push`
  7. `git status` must show clean + up to date

## Suggested repo structure

```
nyc-bike-urbanflow/
├── AGENTS.md
├── PLAN.md
├── README.md
├── apps/
│   └── web/
│       ├── src/
│       │   ├── app/
│       │   ├── components/
│       │   └── lib/
│       └── package.json
├── packages/
│   ├── api/                  # Bun HTTP service (Hono/Elysia)
│   ├── policy/               # Greedy policy engine (pure TS)
│   └── shared/               # Shared types + schemas
├── schemas/                  # API + tile schemas (versioned)
├── contracts/                # Contract fixtures/tests (API <-> UI)
├── artifacts/                # Generated outputs (document generator commands)
├── scripts/                  # One-off tools + backfills
├── sql/                      # Migrations + materialized views
├── fixtures/                 # Contract test fixtures
├── data/                     # Local dev raw archive (optional)
├── .beads/
└── bun.lock
```
- Never expose raw object URLs or listings publicly.

## Beads storage files (DO NOT HAND-EDIT)

- Beads persists issues via its own DB + a git-tracked JSONL export under `.beads/`.
- The JSONL filename may be `issues.jsonl` (current canonical in many setups) or legacy `beads.jsonl` depending on repo history/config.
- NEVER hand-edit Beads JSONL. If something looks wrong, run `bd doctor` (optionally `bd doctor --fix` if instructed) and/or `bd sync`.
