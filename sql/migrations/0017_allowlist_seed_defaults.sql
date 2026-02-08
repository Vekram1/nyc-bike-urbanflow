-- nyc-bike-urbanflow-gtk.20: seed canonical allowlist values for config export

BEGIN;

INSERT INTO namespace_allowlist (kind, system_id, value, note)
VALUES
  ('system_id', NULL, 'citibike-nyc', 'Default Profile A system'),
  ('tile_schema', NULL, 'tile.v1', 'Default composite tile schema namespace'),
  ('severity_version', NULL, 'sev.v1', 'Default severity namespace'),
  ('policy_version', NULL, 'rebal.greedy.v1', 'Default policy namespace'),
  ('layers_set', NULL, 'inv,sev', 'Composite layers default'),
  ('layers_set', NULL, 'inv,press,sev', 'Composite layers with pressure'),
  ('layers_set', NULL, 'inv,epi,sev', 'Composite layers with episodes'),
  ('layers_set', NULL, 'inv,epi,press,sev', 'Composite layers with pressure + episodes'),
  ('compare_mode', NULL, 'off', 'Compare mode: off'),
  ('compare_mode', NULL, 'delta', 'Compare mode: delta'),
  ('compare_mode', NULL, 'split', 'Compare mode: split')
ON CONFLICT DO NOTHING;

COMMIT;
