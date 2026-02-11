-- nyc-bike-urbanflow-fah: seed global policy namespace for frontend strategy parity

BEGIN;

INSERT INTO namespace_allowlist (kind, system_id, value, note)
VALUES ('policy_version', NULL, 'rebal.global.v1', 'Global policy namespace')
ON CONFLICT DO NOTHING;

COMMIT;
