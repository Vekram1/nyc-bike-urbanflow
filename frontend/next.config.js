/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  env: {
    NEXT_PUBLIC_MAPBOX_TOKEN:
      process.env.NEXT_PUBLIC_MAPBOX_TOKEN ?? process.env.MAPBOX_TOKEN ?? "",
    NEXT_PUBLIC_MAPBOX_STYLE:
      process.env.NEXT_PUBLIC_MAPBOX_STYLE ??
      "mapbox://styles/mapbox/dark-v11",
  },
};

module.exports = nextConfig;
