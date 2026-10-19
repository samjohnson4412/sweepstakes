import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  transpilePackages: ["@sweeptrack/core", "@sweeptrack/db"],
  serverExternalPackages: ["pg"],
};

export default nextConfig;
