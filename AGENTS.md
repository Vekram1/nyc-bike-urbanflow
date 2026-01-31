# AGENTS.md — UrbanFlow Twin

## MCP Agent Mail + NTM + Codex operating mode (read once)
This repo is operated via:
- **NTM** for spawning/organizing **Codex-only** agent panes in tmux
- **Beads (`bd`)** as the unit of work / source of truth for task tracking
- **MCP Agent Mail** for durable coordination: threads + acknowledgments + advisory file reservations (leases)

**Codex-only constraint (hard):** use only Codex panes/agents. Do not spawn or rely on Claude/Gemini agents.
**No Gastown:** do not use `gt` commands, Gastown worktrees/crews/hooks, or Gastown mail.

Non-negotiable: **PLAN.md + this file govern all work.** If a worker instruction conflicts with PLAN.md, STOP and reconcile via a doc diff.


## What this file is (read once)
This file is the operating protocol for coding agents working in this repo.
PLAN.md is the product/architecture specification. If AGENTS.md conflicts with PLAN.md, STOP and reconcile via a doc diff.

## Codex instruction pickup (mandatory)
Codex must reliably ingest repo instructions. Therefore:
1) **Always read AGENTS.md + PLAN.md first** before proposing or executing any repo-changing work.
2) If your context is missing critical constraints (profiles, contracts, safety invariant), **STOP** and request a doc refresh / paste of the relevant section(s).
3) Use **MCP Agent Mail thread summaries** to regain context across sessions (see “MCP Agent Mail workflow”).

## 60-second contract summary (do not improvise)
Core invariants from PLAN.md that MUST be preserved:
- Tiles-first: the data plane is `/api/tiles/*` and must degrade first under load.
- Reproducibility: public clients do not request raw `as_of`; they use server-minted `sv` serving view tokens.
- Bounded keyspace: system_id / versions / layers must be allowlisted; reject unknown params with 400 (not cached).
- Determinism: policy + severity + tile schemas are versioned; any semantic change increments versions/namespaces.
- Profile A default: cost-first (<$50/yr). Avoid Profile B infra unless the user explicitly opts in.
- Map UX: MapShell mounts once per session; never remount the Mapbox map.
- Inspect UX: station click freezes playback (no tile URL mutations) until drawer closes.

## Codex compliance checklist (run mentally before acting)
1) Am I operating under a Beads ID? If not, create/claim one first.
2) Did I read PLAN.md sections governing this work?
3) Is this a contract surface (tiles/severity/policy/sv)? If yes, follow the versioned contract protocol or STOP.
4) Any new deps / Profile B / destructive ops / Agent Mail/NTM reconfiguration? If yes, STOP and ask the user.

## When you MUST stop and ask the user
- Adding ANY dependency (runtime or dev) or changing bundler/build stack
- Introducing Profile B infra (Timescale, Redis, dedicated queue/workers, replicas)
- Changing any versioned contract: sv token claims, allowlist dimensions, tile_schema_version, severity_version, policy_version
- Destructive actions (see safety invariant), including DB drops/truncates or deleting raw archives/artifacts
- Installing/reconfiguring coordination tooling without explicit approval:
  - starting/stopping/reinstalling the MCP Agent Mail server
  - installing Agent Mail pre-commit guards / git-hook runners
  - changing NTM global config defaults that affect other projects

## BEFORE ANYTHING ELSE (NTM + Agent Mail + Beads bootstrap)

### 0) Workspace correctness (non-negotiable)
1) Confirm repo root: `git rev-parse --show-toplevel`
2) Confirm your `pwd` is the repo root (or inside it). If not, **STOP** and relocate.
3) If NTM spawned you in the wrong base directory, fix NTM `projects_base` (global or `.ntm/config.toml`) before continuing.

### Then (always)
- Run: `bd onboard` and follow its instructions.
- If Beads is not initialized in this repo, a human should run: `bd init` (or `bd init --stealth` for local-only usage).

### MCP Agent Mail server prerequisite (human-run)
MCP Agent Mail must be running and reachable by Codex via MCP.
- Start server (fast path): `am`
- Or run the provided server script: `./scripts/run_server_with_token.sh`
If the mail tools/resources are unavailable inside Codex, **STOP** and ask the human to start/fix the server.

### MCP Agent Mail bootstrap (agent-run, every session)
Use this repo’s **absolute path** as the project key (Agent Mail calls it `human_key` / `project_key`).
1) Start identity + inbox bootstrap (single call):
   - `macro_start_session(human_key="<ABS_REPO_PATH>", program="codex", model="<codex-model>", task_description="<bd-id>: <short task>")`
2) If continuing an existing Beads thread:
   - `macro_prepare_thread(project_key="<ABS_REPO_PATH>", thread_id="<bd-id>", agent_name="<your-agent-name>")`

## Issue Tracking

This project uses **bd (beads)** for issue tracking.
Run `bd prime` for workflow context, or install hooks (`bd hooks install`) for auto-injection.

**Quick reference:**
- `bd ready` - Find unblocked work
- `bd create "Title" --type task --priority 2` - Create issue
- `bd close <id>` - Complete work
- `bd sync` - Sync with git (run at session end)

For full workflow details: `bd prime`

## NTM dispatch model (Beads-first, Codex-only)
In NTM, Beads IDs are the unit of work. When parallelizing:
- Create/identify the Beads issue ID first.
- Spawn/manage agents with NTM using Codex panes only:
  - `ntm spawn <session> --cod=<N>`
  - `ntm add <session> --cod=<N>`
- Dispatch instructions with NTM broadcast:
  - `ntm send <session> --cod "<bd-id>: <task instructions>"`
- All cross-agent coordination MUST use **MCP Agent Mail** with `thread_id = <bd-id>`.

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

## Workspace invariant (NTM)
- Only perform work inside the correct repo working directory (the one that matches `git rev-parse --show-toplevel`).
- If `pwd` disagrees with the expected repo root, **STOP** and relocate before running any commands.
- Never fix directory confusion by cloning a second copy of the repo.
- If NTM is spawning under the wrong base (e.g., `~/Developer`), fix `projects_base` in NTM config (global or `.ntm/config.toml`) before continuing.

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
- Use **MCP Agent Mail** for durable coordination:
  - Thread key: `thread_id = <bd-id>`
  - Subject prefix: `[<bd-id>] ...`
  - Check inbox regularly; acknowledge messages that request ACK.
- Before editing shared files, acquire **file reservation leases** via Agent Mail (`file_reservation_paths`).
- Use **exclusive=true** for files you expect to modify; keep reservations narrow and time-bounded.

Minimum workflow:
1) Bootstrap session: `macro_start_session(...)` (identity + inbox)
2) Reserve paths before editing:
   - `file_reservation_paths(project_key="<ABS_REPO_PATH>", agent_name="<you>", paths=[...], ttl_seconds=3600, exclusive=true, reason="<bd-id>")`
3) Announce start (and include reservations):
   - `send_message(..., thread_id="<bd-id>", subject="[<bd-id>] Starting", body_md="Reserving: ...", ack_required=true)`
4) During work: reply progress updates in-thread; check inbox periodically (`fetch_inbox(...)`)
5) When done: release reservations + completion message:
   - `release_file_reservations(project_key="<ABS_REPO_PATH>", agent_name="<you>")`
   - `send_message(..., thread_id="<bd-id>", subject="[<bd-id>] Completed", body_md="Summary + paths + commands")`

Reservation rules:
- Prefer small, explicit path lists over broad globs.
- If reservation conflicts: coordinate in-thread, wait for expiry, or choose different files.
- Never bypass reservations for shared areas like `packages/shared/**`, `sql/**`, `apps/web/src/lib/**`.

Optional (human-approved only):
- Install Agent Mail pre-commit guard to block conflicting commits:
  - `install_precommit_guard(project_key="<ABS_REPO_PATH>", code_repo_path="<ABS_REPO_PATH>")`
  - Requires setting `AGENT_NAME` in env for accurate attribution.

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

Additional enforcement (Gastown):
- One Beads issue == one primary role owner by default.
- Cross-role changes require:
  1) mail announcement (Beads ID + files + reason)
  2) either split issues, or explicit user approval to keep combined

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

## Session handoff discipline (required)
After completing any logical chunk of work (or when context feels degraded):
1) Post a thread summary to MCP Agent Mail (`thread_id=<bd-id>`) and/or call `summarize_thread(...)`.
2) Ensure reservations are released.
3) If the agent must be rotated, use NTM to spawn/add a fresh Codex pane and paste the thread summary + Beads status.

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
