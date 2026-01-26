# UrbanFlow Twin Demo Script

Goal: demonstrate replay, diagnosis, and counterfactual improvement for a known failure period.

## Scenario Selection
- Pick a recorded day with multiple empty/full events in Manhattan.
- Identify a 60-minute window with clustered failures (e.g., AM commute).

## Baseline Replay
1. Load replay for the selected window.
2. Highlight empty/full stations and failure-minutes totals.
3. Call out hotspot clusters and any long continuous failures.

## Counterfactual Plan
1. Use default settings: horizon 60 minutes, 1 truck, capacity 20.
2. Run Optimize and display the move list.
3. Show Baseline vs Plan overlay and Difference view.

## Outcome
- Report before/after failure-minutes.
- Highlight stations that recover from empty/full status.

## Notes
- Replay uses Mode A (exogenous deltas) for deterministic comparison.
- Unreliable minutes are reported separately from operational failures.
