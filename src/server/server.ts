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
