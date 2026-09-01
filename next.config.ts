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

// Baseline security headers, applied to every response. Deliberately
// conservative: `script-src` still allows `'unsafe-inline'`/`'unsafe-eval'`
// because Next's own runtime needs them — the value here is blocking
// scripts/frames/objects from OTHER origins (the usual XSS payload and
// clickjacking vectors), not locking down Next itself. `connect-src`
// keeps the Socket.IO WebSocket working (`ws:`/`wss:`). HSTS is left to
// the TLS terminator (Caddy adds it automatically on a real domain — see
// Caddyfile).
const CSP = [
  "default-src 'self'",
  "script-src 'self' 'unsafe-inline' 'unsafe-eval'",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob:",
  "media-src 'self'",
  "font-src 'self'",
  "connect-src 'self' ws: wss:",
  "object-src 'none'",
  "base-uri 'self'",
  "form-action 'self'",
  "frame-ancestors 'none'",
].join("; ");

const nextConfig: NextConfig = {
  reactStrictMode: true,
  async headers() {
    return [
      {
        source: "/:path*",
        headers: [
          { key: "Content-Security-Policy", value: CSP },
          { key: "X-Frame-Options", value: "DENY" },
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
          { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=()" },
        ],
      },
    ];
  },
};

export default nextConfig;
