# Station Endpoints

Bead: `nyc-bike-urbanflow-gtk.10`

## Endpoints

- `GET /api/stations/{station_key}?sv=...`
  - returns bounded station detail used by Inspect drawer.
- `GET /api/stations/{station_key}/series?v=1&sv=...&from=...&to=...&bucket=...`
  - `start/end` aliases are accepted for `from/to`.
  - returns bounded, bucketed series for bikes/docks and optional severity/pressure.

## Abuse bounds (Profile A)

- `sv` is required and validated first.
- `station_key` must match safe pattern and max length (80 chars).
- Series range constraints:
  - max window: `max_series_window_s`
  - max bucket points: `max_series_points`
  - bucket bounds: 60s to 3600s
- Invalid or unbounded requests return `400` with `Cache-Control: no-store`.

## Logging

Structured events emitted for:
- detail hit/miss by `system_id`, `station_key`, `view_id`
- series requests with `from/to`, `bucket_seconds`, `points_returned`
- rejection codes for invalid key/range/bucket/point-count
