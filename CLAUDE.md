# CLAUDE.md — Codex Bootstrap Mirror (UrbanFlow Twin)

Authoritative protocol lives in AGENTS.md; this is a bootstrap mirror for Codex.

**Authoritative agent protocol lives in `AGENTS.md`.**
This file is a minimal bootstrap mirror so Codex reliably ingests the non-negotiables.
If `CLAUDE.md` conflicts with `AGENTS.md` or `PLAN.md`, STOP and request a doc diff.

## 60-second contract summary (do not improvise)

Core invariants from PLAN.md that MUST be preserved:
- Tiles-first: the data plane is `/api/tiles/*` and must degrade first under load.
- Reproducibility: public clients do not request raw `as_of`; they use server-minted `sv` serving view tokens.
- Bounded keyspace: system_id / versions / layers must be allowlisted; reject unknown params with 400 (not cached).
- Determinism: policy + severity + tile schemas are versioned; any semantic change increments versions/namespaces.
- Profile A default: cost-first (<$50/yr). Avoid Profile B infra unless the user explicitly opts in.
- Map UX: MapShell mounts once per session; never remount the Mapbox map.
- Inspect UX: station click freezes playback (no tile URL mutations) until drawer closes.

## STOP and ask the user if ANY are true

- Adding ANY dependency (runtime or dev) or changing bundler/build stack
- Introducing Profile B infra (Timescale, Redis, dedicated queue/workers, replicas)
- Changing any versioned contract: `sv` token claims, allowlist dimensions, `tile_schema_version`, `severity_version`, `policy_version`
- Destructive actions: DB drops/truncates, deleting raw archives/artifacts
- Gastown state mutations without explicit approval (`gt doctor --fix`, deleting rigs/crews/hooks/worktrees)

## Absolute safety invariant (do not violate)

You may NOT delete, overwrite, or irreversibly modify files/data unless the user provides the exact command and explicit approval in the same session.
Forbidden examples (non-exhaustive): `rm -rf`, `git reset --hard`, `git clean -fd`, force push, clobbering redirects (`>`), in-place `sed -i`.

## Gastown + Codex bootstrap (do first)

When running in a Gastown rig/crew/hook:
1) `gt prime`
2) If expecting queued coordination: `gt mail check --inject`
3) If “idle” waiting for prompt: `gt nudge deacon session-started`

Then:
- `bd onboard` (and follow instructions)
- If Beads not initialized: human runs `bd init` (or `bd init --stealth` for local-only)

## Beads workflow (minimum standard)

- Do not work >2 minutes without a Beads issue.
- Start work: `bd ready --json` → pick an unblocked issue → `bd update <id> --claim`
- Implement small diffs; record PLAN.md section(s) touched + contract surface.
- Finish: run quality gates; `bd close <id>`; `bd sync` per repo rules.
- Never hand-edit `.beads/*.jsonl`.

## Versioned contract change protocol (non-negotiable)

If change affects public semantics or caching:
1) Identify surface: tiles | severity | policy | sv
2) Apply versioning: bump `tile_schema_version` / `severity_version` / `policy_version` as applicable
3) Update allowlists
4) Update fixtures + contract tests (`fixtures/`, `contracts/`)
5) Update PLAN.md if spec changed
If you cannot complete steps (2)-(4), STOP and ask.

## Quality gates (run before closing a code-changing issue)

Frontend (`apps/web`): `bun run lint`, `bun run build`, (if present) `bun run test`
API (`packages/api`): `bun run lint`, `bun run typecheck`, (if present) `bun run test`

## Session completion (always)

End with:
- Changes (files + why)
- Contract surfaces touched (tiles | severity | policy | sv | control plane)
- Version bumps (old→new or none)
- Cache-key / allowlist impact
- Beads IDs touched + status changes
- Commands executed (ok/fail)

Git rule: do not push unless user explicitly asks in this session.
