import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  /* config options here */
  cacheComponents: true,
  // Loads its ML model from files inside its own package folder, so it can't be bundled.
  serverExternalPackages: ["@imgly/background-removal-node"],
  // File tracing picks up onnxruntime's small binding but not the runtime library
  // it loads at run time, so Kajol's background removal would fail on deploy
  // (Vercel runs linux x64).
  outputFileTracingIncludes: {
    "/api/agents/kajol": ["./node_modules/onnxruntime-node/bin/napi-v3/linux/x64/**/*"],
  },
  partialPrefetching: true,
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
