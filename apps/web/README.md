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

## Logging (Debug)

Map/HUD state transitions that affect request behavior are logged in the browser console:

- `MapView`: mount/unmount, map load, source/layer readiness, source refresh updates/failures.
- `MapShell`: inspect lock transitions, playback/speed changes, layer toggle changes.
