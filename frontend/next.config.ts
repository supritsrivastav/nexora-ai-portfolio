import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  cacheComponents: true,
  partialPrefetching: true,
  output: "standalone",
  async rewrites() {
    const backendApiUrl = process.env.BACKEND_API_URL ?? (
      process.env.VERCEL ? "" : "http://localhost:8080/api"
    );
    if (!backendApiUrl) {
      throw new Error("BACKEND_API_URL must be configured for Vercel deployments.");
    }
    const upstream = new URL(backendApiUrl);
    if (
      !["http:", "https:"].includes(upstream.protocol) ||
      upstream.username ||
      upstream.password ||
      upstream.search ||
      upstream.hash ||
      !upstream.pathname.replace(/\/+$/, "").endsWith("/api")
    ) {
      throw new Error("BACKEND_API_URL must be an HTTP(S) backend /api URL without credentials.");
    }
    return [
      {
        source: "/api/:path*",
        destination: `${backendApiUrl.replace(/\/+$/, "")}/:path*`,
      },
    ];
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
