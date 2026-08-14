// Must be the first import, and must be a dedicated side-effect module —
// see src/server/loadEnv.ts for why. Loads .env into process.env before
// any other import (e.g. src/server/db/client.ts, reached transitively
// through createSocketServer below) can read from it. Neither `tsx` nor
// Next's own env loading (which only kicks in once `next()` boots, too
// late for our own imports) do this for a custom entrypoint on their own.
// Harmless in Docker: .env is dockerignored, so this just no-ops there and
// the env vars docker-compose injects directly are used as-is (dotenv
// never overwrites an already-set variable).
import "@/server/loadEnv";

import { createServer } from "node:http";
import next from "next";
import { createSocketServer } from "@/server/sockets";
import { logger } from "@/server/logger";

/**
 * Custom server entrypoint.
 *
 * This exists for exactly one reason: Socket.IO needs a raw http.Server to
 * attach to (WebSocket upgrade handling isn't reachable from a Next.js
 * Route Handler). Everything else about this file should stay minimal —
 * see AGENTS.md "Custom server constraints" before adding anything here
 * that isn't "wire Next.js + Socket.IO into one http.Server".
 */

const dev = process.env.NODE_ENV !== "production";
const port = Number(process.env.PORT ?? 3000);

const app = next({ dev });
const handle = app.getRequestHandler();

app
  .prepare()
  .then(() => {
    const httpServer = createServer((req, res) => {
      handle(req, res);
    });

    createSocketServer(httpServer);

    httpServer.listen(port, () => {
      logger.info({ port, dev }, "ViewerBattle server ready");
    });
  })
  .catch((error: unknown) => {
    logger.error({ error }, "failed to start server");
    process.exit(1);
  });
