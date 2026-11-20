import path from "path";

/** @type {import('next').NextConfig} */
const nextConfig = {
  experimental: {
    externalDir: true,
  },

  outputFileTracingRoot: path.join(
    process.cwd(),
    "../.."
  ),

  // db-stations reads its bundled NDJSON catalogue at runtime. Include it
  // explicitly in the nearby-stations serverless function trace.
  outputFileTracingIncludes: {
    "/api/admin/stations/nearby": [
      "./data/db-stations.ndjson",
    ],
  },
};

export default nextConfig;