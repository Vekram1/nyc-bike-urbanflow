export function apiBaseUrl(): string {
  return process.env.NEXT_PUBLIC_API_BASE_URL ?? "http://localhost:8000";
}

export function mapboxToken(): string {
  return process.env.NEXT_PUBLIC_MAPBOX_TOKEN ?? "";
}

export function mapboxStyleUrl(): string {
  return (
    process.env.NEXT_PUBLIC_MAPBOX_STYLE ??
    "mapbox://styles/mapbox/dark-v11"
  );
}
