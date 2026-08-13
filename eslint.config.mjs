import nextConfig from "eslint-config-next";

/**
 * Import-boundary rule enforcing the locked architecture:
 *   - src/domain (Game Kernel) must not import server/app/ui code — it has
 *     to stay pure, framework-agnostic, and unit-testable without I/O.
 *   - src/ui (UI Component Kernel) must not import server/app code.
 * See AGENTS.md for the reasoning.
 */
const boundaries = {
  files: ["src/domain/**/*.{ts,tsx}"],
  rules: {
    "no-restricted-imports": [
      "error",
      {
        patterns: [
          { group: ["@/server/*", "@/app/*", "@/ui/*"], message: "src/domain must stay pure: no server, app, or ui imports." },
        ],
      },
    ],
  },
};

const uiBoundaries = {
  files: ["src/ui/**/*.{ts,tsx}"],
  rules: {
    "no-restricted-imports": [
      "error",
      {
        patterns: [
          { group: ["@/server/*", "@/app/*"], message: "src/ui must not import server or app code." },
        ],
      },
    ],
  },
};

const config = [
  { ignores: ["src/generated/**"] },
  ...nextConfig,
  boundaries,
  uiBoundaries,
];

export default config;
