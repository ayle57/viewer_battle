/**
 * Loads .env into process.env, as a side effect of importing this module.
 *
 * This has to be a dedicated module rather than inline code in
 * server.ts: ES module evaluation runs ALL of a module's own imports
 * (recursively) before any of that module's own top-level statements,
 * regardless of where those statements are textually positioned — so
 * `import { config } from "dotenv"; config()` written at the top of
 * server.ts would still run *after* server.ts's other imports (including
 * the one that transitively reaches src/server/db/client.ts) have already
 * evaluated and read process.env.DATABASE_URL. Putting the config() call
 * inside its own module and doing `import "./loadEnv"` first instead
 * works, because that whole side-effecting module body runs to
 * completion before the next sibling import is evaluated.
 */
import { config } from "dotenv";

// quiet: true suppresses dotenv's stdout ad banner (its own "tips"
// feature promoting other products) — not something we want in server logs.
config({ quiet: true });
