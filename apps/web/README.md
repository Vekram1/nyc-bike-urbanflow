# Web App (`apps/web`)

Frontend for UrbanFlow Twin (Profile A default), built with Next.js + React + TypeScript.

## Commands

Use Bun for all tasks:

```bash
bun run dev
bun run lint
bun run build
```

## HUD Layout Intent

The map is full-bleed and mounted once per session. All controls render as overlay HUD cards above the map.

- Top center: clock + serving status
- Bottom: timeline scrubber and playback controls
- Left: command stack and layer toggles
- Right: network stats and performance

`HUDRoot` keeps `pointer-events: none` globally, while interactive cards enable `pointer-events: auto` so map pan/zoom still works around controls.

## Playback and Inspect Behavior

- Playback is controlled by `useHudControls`.
- Opening station inspect pauses playback and freezes map data updates (`freeze=true` on `MapView`).
- Closing inspect resumes playback only if it was playing before inspect opened.
- Keyboard shortcuts route through `useHudControls.handleHotkey` (`Space`, arrows, `Home`, `End`, `-`, `+`).
- While inspect is open (`inspectLocked=true`), timeline mutations are blocked:
  - play/pause toggle
  - speed changes
  - seek and bucket step actions
  This prevents deterministic-view drift while station details are open.
- Station drawer Tier1 uses map feature payload only (no fetch on open):
  - `station_id`, `name`, `capacity`, `bikes`, `docks`
  - optional `bucket_quality`, `t_bucket` when provided by source props
- Station drawer Tier2 is explicit user action (`Details` button), not automatic on open.
  - Fetch is debounced by `350ms` to avoid request thrash from rapid clicks.
  - Request includes bounded params aligned to backend contract: `v=1`, `sv`, `T_bucket`, `range=6h`.
  - `T_bucket` is derived from tile payload (`gbfs_last_updated` preferred, then parsed `t_bucket`) with epoch-second fallback.
  - Frontend logs bundle size in bytes after successful load (`tier2_loaded`).
  - If the endpoint is unavailable, Tier1 remains usable and Tier2 reports a bounded error message.

## TimeController State Rules

- State model:
  - `playing`: playback clock running
  - `inspectLocked`: station drawer lock active
  - `progress`: scrubber position (`0..1`) used for timeline bucket selection
- Guards:
  - `inspectLocked` supersedes mutation actions and blocks timeline updates from UI/hotkeys.
  - tab visibility auto-pause/resume is preserved (`visibilitychange`).
- Step granularity:
  - bucket stepping changes `progress` by `0.01` per action.
- Compare mode:
  - `compareMode` enables secondary time context.
  - `compareOffsetBuckets` defines `T2_bucket = max(0, T_bucket - compareOffsetBuckets)`.
  - `splitView` is only actionable when compare mode is enabled.
- Debounce/anti-thrash behavior:
  - no delayed resume timer is used; inspect open/close transitions are edge-triggered and deterministic.
  - repeated blocked actions during inspect are ignored and logged, not queued.

## Logging (Debug)

Map/HUD state transitions that affect request behavior are logged in the browser console:

- `MapView`: mount/unmount, map load, source/layer readiness, source refresh updates/failures.
- `MapShell`: inspect lock transitions, playback/speed changes, layer toggle changes.
- `MapShell`: `tile_request_key_changed` emits a deterministic key from `{layers, timelineBucket, inspectLocked}`.
  - During inspect lock, HUD timeline mutation actions are blocked, so the request key stays stable.
- In compare mode the request key additionally includes:
  - `compare_mode`
  - `t2_bucket`
  - `split_view`
- `MapShell`: inspect-lock invariant logs:
  - `inspect_tile_key_mutated` (error) if request key changes while drawer is open.
- `MapShell`: explicit Tier1 drawer lifecycle logs:
  - `tier1_drawer_opened`
  - `tier1_drawer_closed`
- E2E runtime snapshot for browser-driven checks:
  - `window.__UF_E2E.mapShellMounted`
  - `window.__UF_E2E.mapShellMountCount`
  - `window.__UF_E2E.mapShellUnmountCount`
  - `window.__UF_E2E.mapShellLastMountTs`
  - `window.__UF_E2E.mapShellLastUnmountTs`
  - `window.__UF_E2E.mapViewMountCount`
  - `window.__UF_E2E.inspectOpen`
  - `window.__UF_E2E.selectedStationId`
  - `window.__UF_E2E.timelineBucket`
  - `window.__UF_E2E.compareBucket`
  - `window.__UF_E2E.tileRequestKey`
  - `window.__UF_E2E.tileRequestKeyHistory` (bounded last 40 entries)
  - `window.__UF_E2E.invariantViolations` (bounded last 20 entries)
  - `window.__UF_E2E.invariantViolationCount`
  - `window.__UF_E2E.lastInvariantViolation`
  - `window.__UF_E2E.lastInvariantViolationAt`
  - `window.__UF_E2E.inspectOpenCount`
  - `window.__UF_E2E.inspectCloseCount`
  - `window.__UF_E2E.inspectCloseReasons` (`drawer_close_button`, `escape_key`)
  - `window.__UF_E2E.inspectOpenedAt`
  - `window.__UF_E2E.inspectClosedAt`
  - `window.__UF_E2E.inspectLastCloseReason`
  - `window.__UF_E2E.hotkeyHandledCount`
  - `window.__UF_E2E.hotkeyIgnoredCount`
  - `window.__UF_E2E.hotkeyLastCode`
  - `window.__UF_E2E.inspectAnchorTileRequestKey`
  - `window.__UF_E2E.inspectSessionId`
  - `window.__UF_E2E.controlsDisabled`
  - `window.__UF_E2E.compareEnabled`
  - `window.__UF_E2E.splitEnabled`
  - `window.__UF_E2E.layerSeverityEnabled`
  - `window.__UF_E2E.layerCapacityEnabled`
  - `window.__UF_E2E.layerLabelsEnabled`
  - `window.__UF_E2E.compareOffsetBuckets`
  - `window.__UF_E2E.playbackSpeed`
  - `window.__UF_E2E.playing`
  - `window.__UF_E2E.hudActionCounts`
  - `window.__UF_E2E.hudLastAction`
  - `window.__UF_E2E.blockedActions` (per-action counters while inspect lock blocks controls)
  - `window.__UF_E2E.hudLastBlockedAction`
  - `window.__UF_E2E.hudLastBlockedReason` (`inspect_lock` | `compare_mode_disabled`)
  - `window.__UF_E2E.hudLastBlockedAt`
  - `window.__UF_E2E.mapRefreshAttempts`
  - `window.__UF_E2E.mapRefreshSuccess`
  - `window.__UF_E2E.mapRefreshFailureCount`
  - `window.__UF_E2E.mapRefreshSkippedFrozen`
  - `window.__UF_E2E.mapRefreshSkippedNoMap`
  - `window.__UF_E2E.mapRefreshSkippedNoSource`
  - `window.__UF_E2E.mapRefreshBadPayload`
  - `window.__UF_E2E.mapRefreshLastFeatureCount`
  - `window.__UF_E2E.mapRefreshLastAttemptTs`
  - `window.__UF_E2E.mapRefreshLastSuccessTs`
  - `window.__UF_E2E.mapRefreshLastSkipReason`
  - `window.__UF_E2E.mapRefreshLastErrorMessage`
  - `window.__UF_E2E.mapStationPickCount`
  - `window.__UF_E2E.mapClickMissCount`
  - `window.__UF_E2E.mapLastPickedStationId`
  - `window.__UF_E2E.mapFeatureStateSetCount`
  - `window.__UF_E2E.mapFeatureStateClearCount`
  - `window.__UF_E2E.mapFeatureStateErrorCount`
  - `window.__UF_E2E.mapFeatureStateLastSelectedId`
  - `window.__UF_E2E.tier1OpenedCount`
  - `window.__UF_E2E.tier2RequestedCount`
  - `window.__UF_E2E.tier2LoadingCount`
  - `window.__UF_E2E.tier2SuccessCount`
  - `window.__UF_E2E.tier2ErrorCount`
  - `window.__UF_E2E.tier2DebounceScheduledCount`
  - `window.__UF_E2E.tier2AbortCount`
  - `window.__UF_E2E.tier2LastBundleBytes`
  - `window.__UF_E2E.tier2LastHttpStatus`
  - `window.__UF_E2E.tier2LastStationKey`
  - `window.__UF_E2E.tier2InFlight`
  - `window.__UF_E2E.tier2LastRequestedBucket`
  - `window.__UF_E2E.tier2LastRequestedRange`
  - `window.__UF_E2E.tier2LastErrorMessage`
  - `window.__UF_E2E.tier2UiStatus`
  - `window.__UF_E2E.tier2UiMessage`
  - `window.__UF_E2E.tier2UiBundleBytes`
- Stable selector hooks for browser tests:
- `data-uf-id="app-root"`
- `data-uf-id="map-shell"`
- `data-uf-id="hud-clock"`
- `data-uf-id="clock-date"`
- `data-uf-id="clock-time"`
- `data-uf-id="clock-mode-badge"` with `data-uf-mode="live|replay"`
- `data-uf-id="clock-sv"`
- `data-uf-id="clock-inspect-lock"`
- `data-uf-id="clock-delayed"`
- `data-uf-id="hud-timeline"`
- `data-uf-id="hud-controls"`
- `data-uf-id="hud-stats"`
- `data-uf-id="stats-title"`
- `data-uf-id="stats-constrained-badge"`
- `data-uf-id="stats-row-stations"`
- `data-uf-id="stats-value-stations"`
- `data-uf-id="stats-row-constrained"`
- `data-uf-id="stats-value-constrained"`
- `data-uf-id="stats-row-tile-p95"`
- `data-uf-id="stats-value-tile-p95"`
- `data-uf-id="stats-row-fps"`
- `data-uf-id="stats-value-fps"`
- `data-uf-id="stats-sparkline"`
- `data-uf-id="stats-sparkline-empty"`
- `data-uf-id="station-drawer"`
- `data-uf-station-key="<station_key>"`
- `data-uf-tier2-status="idle|loading|success|error"`
- `data-uf-tier2-t-bucket="<epoch_seconds>"`
- `data-uf-id="drawer-tier2-button"`
- `data-uf-id="drawer-close-button"`
- `data-uf-id="drawer-row-station-key"`
- `data-uf-id="drawer-row-capacity"`
- `data-uf-id="drawer-row-bikes"`
- `data-uf-id="drawer-row-docks"`
- `data-uf-id="drawer-row-bucket-quality"`
- `data-uf-id="drawer-row-t-bucket"`
- `data-uf-id="drawer-station-title"`
- `data-uf-id="drawer-updated-text"`
- `data-uf-id="drawer-tier1-note"`
- `data-uf-id="drawer-tier2-status-text"`
- `data-uf-id="drawer-tier2-bundle-size"`
- `data-uf-id="scrubber-play-toggle"`
- `data-uf-id="scrubber-speed-down"`
- `data-uf-id="scrubber-speed-up"`
- `data-uf-id="scrubber-speed-value"`
- `data-uf-id="scrubber-track"`
  - `data-uf-progress-percent="<0-100>"`
  - `data-uf-playing="true|false"`
  - `data-uf-inspect-locked="true|false"`
- `data-uf-id="scrubber-step-back"`
- `data-uf-id="scrubber-step-forward"`
- `data-uf-id="scrubber-progress-label"`
- `data-uf-id="command-play-toggle"`
- `data-uf-id="layer-toggle-severity"`
- `data-uf-id="layer-toggle-capacity"`
- `data-uf-id="layer-toggle-labels"`
- `data-uf-id="compare-mode-toggle"`
- `data-uf-id="compare-mode-state"`
- `data-uf-id="compare-split-toggle"`
- `data-uf-id="compare-split-state"`
- `data-uf-id="compare-offset-down"`
- `data-uf-id="compare-offset-up"`
- `data-uf-id="compare-offset-value"` with `data-uf-offset-buckets="<n>"`
