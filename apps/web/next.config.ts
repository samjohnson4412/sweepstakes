import path from "node:path";
import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  transpilePackages: ["@sweeptrack/core", "@sweeptrack/db", "@sweeptrack/ingest"],
  output: "standalone",
  outputFileTracingRoot: path.join(import.meta.dirname, "../.."),
  serverExternalPackages: ["pg"],
};

export default nextConfig;
