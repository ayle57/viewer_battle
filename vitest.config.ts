import { defineConfig } from "vitest/config";
import path from "node:path";

export default defineConfig({
  test: {
    environment: "node",
    include: ["tests/**/*.test.ts", "src/**/*.test.ts"],
    setupFiles: ["./tests/setup.ts"],
    // Integration test files share ONE real Postgres instance (no
    // per-file test database) — always true, but harmless as long as
    // every table only ever had one file writing to it. Adding
    // content-geo.test.ts as a SECOND file that creates ContentHost rows
    // exposed a real cross-file race: content.test.ts's own auth tests
    // exercise the real `signInContentHost` reattach path (contentHost.ts),
    // which looks up "the globally earliest ContentHost row" and rotates
    // its token — with file-level parallelism, that row can belong to
    // the OTHER file's still-running test, silently invalidating its
    // token mid-run. Not a bug in either file's own logic (a real
    // single-Host production deployment never has two files racing to
    // create ContentHost rows) — it's test SCHEDULING, and turning it off
    // makes the whole suite deterministic for a fraction more wall-clock
    // time, without changing what any test actually asserts.
    fileParallelism: false,
  },
  resolve: {
    alias: {
      "@": path.resolve(import.meta.dirname, "./src"),
    },
  },
});
