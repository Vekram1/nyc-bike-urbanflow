create table if not exists stations (
  station_id text primary key,
  name text,
  lat double precision,
  lon double precision,
  capacity integer
);

create table if not exists snapshots (
  snapshot_id text primary key,
  ts timestamptz not null,
  feed_ts timestamptz,
  ingest_meta jsonb,
  is_valid boolean not null default true
);

create table if not exists snapshot_station_status (
  snapshot_id text references snapshots(snapshot_id),
  station_id text,
  bikes_available integer,
  docks_available integer,
  is_installed boolean,
  is_renting boolean,
  is_returning boolean,
  num_bikes_disabled integer,
  num_docks_disabled integer
);

create table if not exists bins_5m (
  station_id text not null,
  ts timestamptz not null,
  bikes_available integer,
  docks_available integer,
  delta_bikes integer,
  delta_docks integer,
  capacity_source text,
  is_reliable boolean,
  reliability_reason text,
  primary key (station_id, ts)
);
