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
- Debounce/anti-thrash behavior:
  - no delayed resume timer is used; inspect open/close transitions are edge-triggered and deterministic.
  - repeated blocked actions during inspect are ignored and logged, not queued.

## Logging (Debug)

Map/HUD state transitions that affect request behavior are logged in the browser console:

- `MapView`: mount/unmount, map load, source/layer readiness, source refresh updates/failures.
- `MapShell`: inspect lock transitions, playback/speed changes, layer toggle changes.
