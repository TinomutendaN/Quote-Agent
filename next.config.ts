import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  cacheComponents: true,
  partialPrefetching: true,
  // Stop `next dev` from writing its own block into our AGENTS.md.
  agentRules: false,
  // The Inbox reads email subject lines from the sample files on the server.
  outputFileTracingIncludes: {
    "/inbox": ["./public/samples/*.txt"],
    // The agent reads the sample quote files from disk.
    "/api/agent": ["./public/samples/**"],
  },
  turbopack: {
    rules: {
      "*.css": {
        loaders: ["@tailwindcss/turbopack"],
        as: "*.css",
      },
    },
  },
};

export default nextConfig;
