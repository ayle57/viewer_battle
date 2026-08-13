import type { NextConfig } from "next";

/**
 * NOTE (Phase 0 spike): we intentionally do NOT use `output: "standalone"`.
 *
 * Standalone output generates its own minimal server.js designed to replace
 * `next start`. We run our own custom server (src/server/server.ts) to attach
 * Socket.IO to the same http.Server, so we build normally and run the app
 * against the regular `.next` directory with full node_modules in Docker.
 *
 * This trades a larger production image for a simpler, more predictable
 * build/deploy story. Revisit only if image size becomes a measured problem
 * (see AGENTS.md "Custom server constraints").
 */
const nextConfig: NextConfig = {
  reactStrictMode: true,
};

export default nextConfig;
