import { z } from "zod";
import type { Server as SocketIOServer, Socket } from "socket.io";
import { isTeamRole, type TeamRole } from "@/domain/session";
import type { SocketIdentity } from "@/server/auth";
import { getCurrentGame } from "@/server/game";
import { logger } from "@/server/logger";

/**
 * The live Drawing canvas — a deliberately EPHEMERAL realtime layer,
 * entirely separate from the Game Kernel/`SessionGame.internalState`. The
 * Kernel (src/domain/game/drawing) owns phase/timer/turn/scoring — the
 * one, sole source of truth for "whose turn is it, are we drawing or
 * guessing, who's the drawer" — this module only ever RE-READS that truth
 * (via `getCurrentGame`, the same read every other socket feature uses)
 * to decide what a stroke request may do; it never decides game rules
 * itself. Strokes themselves never touch Postgres — same "not gameplay
 * state, don't persist it" posture as presence.ts's own connection
 * tracking (see that file's doc comment), which this module's in-memory
 * buffer shape directly mirrors: a plain Map, pinned to `globalThis` for
 * the identical dev-mode cross-module-graph reason (a tRPC mutation
 * doesn't currently touch this buffer, but pinning costs nothing and
 * avoids the exact bug class presence.ts's own doc comment describes if
 * one ever does).
 *
 * Privacy (no opponent/Display sees the drawing before reveal) is
 * enforced by RE-CHECKING live Kernel state on every single request —
 * not by room membership alone (Socket.IO room joins are additive/
 * static per connection, so they can't by themselves express "only while
 * phase is still 'drawing'"): `drawing:request-snapshot` looks at the
 * CURRENT `phase`/`activeTeam` every time it's asked, so a socket that
 * asks too early (or a stale client that doesn't know the round already
 * moved on) always gets the answer that's actually true right now, not a
 * cached decision from connect time. Same reasoning for
 * `drawing:request-prompt`: the secret word is handed out only to a
 * socket whose OWN identity (`displayName`, the same "player identity"
 * convention GeoGuessr's `byName` already established — see
 * src/domain/game/drawing/types.ts's top comment) matches the Kernel's
 * current `drawerName`, re-checked fresh every time, which is also what
 * makes this the reconnect story for free: a refreshed drawer just asks
 * again and gets the same true answer.
 */

const drawingPointSchema = z.object({ x: z.number().min(0).max(1), y: z.number().min(0).max(1) });
const drawingStrokeSchema = z.object({
  points: z.array(drawingPointSchema).min(2).max(2000),
  color: z.string().min(1).max(32),
  width: z.number().positive().max(64),
});
export type DrawingStroke = z.infer<typeof drawingStrokeSchema>;

/** Defensive cap on how many strokes one round's buffer holds — a runaway/misbehaving client shouldn't be able to grow this without bound; a real drawing round realistically produces dozens of strokes, not thousands. */
const MAX_STROKES_PER_ROUND = 500;

interface DrawingBuffer {
  /** Which turn this buffer belongs to — `currentPromptIndex` from the live Kernel state, stringified. A mismatch means a new turn started since this buffer was written, so it's treated as stale/empty rather than needing an explicit "clear on new round" signal wired in from the Kernel's own events (see this file's top comment: this module only ever RE-READS Kernel state, never reacts to its events directly). */
  roundKey: string;
  strokes: DrawingStroke[];
}

type DrawingBufferMap = Map<string, DrawingBuffer>; // keyed by sessionId

// Pinned to globalThis — same dev-mode hot-reload/cross-module-graph
// safety as presence.ts's own sessionPresence Map (see that file's doc
// comment for the full story of the real bug this pattern exists to
// avoid).
const globalForDrawing = globalThis as unknown as { drawingBuffers?: DrawingBufferMap };
const drawingBuffers: DrawingBufferMap = globalForDrawing.drawingBuffers ?? (globalForDrawing.drawingBuffers = new Map());

function drawingRoomName(sessionId: string, team: TeamRole): string {
  return `session:${sessionId}:drawing:${team}`;
}

/**
 * The one shape this module cares about from DrawingState — duck-typed
 * rather than importing the real `DrawingState` type, because this file
 * intentionally treats the Kernel as an opaque JSON blob the same way
 * src/server/game/service.ts does everywhere else (see that file's own
 * top comment: "Prisma never inspects or branches on what's inside the
 * JSON"). `getCurrentGame` already guarantees `gameKey === "drawing"`
 * before this is ever read.
 */
interface LiveDrawingFacts {
  phase: string;
  activeTeam: TeamRole;
  drawerName: string | null;
  currentPromptIndex: number;
  prompts: { text: string }[];
}

async function currentDrawingFacts(sessionId: string): Promise<LiveDrawingFacts | null> {
  const game = await getCurrentGame(sessionId);
  if (!game || game.gameKey !== "drawing") return null;
  return game.internalState as LiveDrawingFacts;
}

function getOrResetBuffer(sessionId: string, roundKey: string): DrawingBuffer {
  const existing = drawingBuffers.get(sessionId);
  if (existing && existing.roundKey === roundKey) return existing;
  const fresh: DrawingBuffer = { roundKey, strokes: [] };
  drawingBuffers.set(sessionId, fresh);
  return fresh;
}

/** Only HOST or a member of the currently-drawing team may see real strokes while `phase === "drawing"` — the opposing team and Display get an empty snapshot until the round leaves "drawing" (COUNTDOWN_EXPIRED moves it to "guessing"), at which point the drawing is public to everyone, same "no reading ahead, no hiding the past" posture as every other engine's toPublicView. */
function mayViewLiveStrokes(role: SocketIdentity["role"], facts: LiveDrawingFacts): boolean {
  if (facts.phase !== "drawing") return true; // already safe to reveal to everyone
  return role === "HOST" || role === facts.activeTeam;
}

type SnapshotAck = (response: { strokes: DrawingStroke[] }) => void;
type PromptAck = (response: { text: string | null }) => void;
type StrokeAck = (response: { ok: true } | { ok: false; error: string }) => void;

export function registerDrawingHandlers(io: SocketIOServer, socket: Socket) {
  const identity = socket.data.identity as SocketIdentity;

  // HOST joins BOTH team rooms (full visibility, same posture as every
  // other realtime feature in this app); a team role joins only its own.
  // DISPLAY joins neither — it only ever pulls a snapshot on demand
  // (`drawing:request-snapshot`), never gets live strokes pushed, which
  // is what keeps "Display doesn't see the drawing before reveal" true
  // even if a future bug ever broadcast to the wrong room: DISPLAY was
  // never a member to begin with.
  if (identity.role === "HOST") {
    socket.join(drawingRoomName(identity.sessionId, "TEAM_A"));
    socket.join(drawingRoomName(identity.sessionId, "TEAM_B"));
  } else if (isTeamRole(identity.role)) {
    socket.join(drawingRoomName(identity.sessionId, identity.role));
  }

  socket.on("drawing:stroke", (payload: unknown, ack?: StrokeAck) => {
    void (async () => {
      const facts = await currentDrawingFacts(identity.sessionId);
      if (!facts) return ack?.({ ok: false, error: "NO_DRAWING_GAME" });
      if (facts.phase !== "drawing") return ack?.({ ok: false, error: "WRONG_PHASE" });
      if (identity.role !== facts.activeTeam || identity.displayName !== facts.drawerName) {
        return ack?.({ ok: false, error: "NOT_THE_DRAWER" });
      }
      const parsed = drawingStrokeSchema.safeParse(payload);
      if (!parsed.success) return ack?.({ ok: false, error: "INVALID_STROKE" });

      const buffer = getOrResetBuffer(identity.sessionId, String(facts.currentPromptIndex));
      if (buffer.strokes.length >= MAX_STROKES_PER_ROUND) return ack?.({ ok: false, error: "TOO_MANY_STROKES" });
      buffer.strokes.push(parsed.data);

      io.to(drawingRoomName(identity.sessionId, facts.activeTeam)).emit("drawing:stroke", parsed.data);
      ack?.({ ok: true });
    })().catch((error: unknown) => {
      logger.error({ error, socketId: socket.id }, "failed to apply drawing stroke");
      ack?.({ ok: false, error: "INTERNAL_ERROR" });
    });
  });

  // The real "undo last stroke" — same shape/authorization as
  // `drawing:clear` right below (only the current drawer, only mid-
  // "drawing" phase), popping exactly one stroke off the in-memory
  // buffer instead of wiping it. A real, audited gap: the only way to
  // correct a slipped tap on a touch canvas used to be "Clear," erasing
  // the whole drawing under a running timer. Broadcasts a plain
  // `drawing:undo` (no payload — every receiver already has its own
  // copy of the strokes array; popping the last element locally is the
  // client's own job, same "server says WHAT happened, client applies
  // it" split `drawing:clear` already uses).
  socket.on("drawing:undo", (_payload: unknown, ack?: StrokeAck) => {
    void (async () => {
      const facts = await currentDrawingFacts(identity.sessionId);
      if (!facts) return ack?.({ ok: false, error: "NO_DRAWING_GAME" });
      if (facts.phase !== "drawing") return ack?.({ ok: false, error: "WRONG_PHASE" });
      if (identity.role !== facts.activeTeam || identity.displayName !== facts.drawerName) {
        return ack?.({ ok: false, error: "NOT_THE_DRAWER" });
      }
      const buffer = getOrResetBuffer(identity.sessionId, String(facts.currentPromptIndex));
      if (buffer.strokes.length === 0) return ack?.({ ok: true }); // nothing to undo — not an error, just a no-op
      buffer.strokes = buffer.strokes.slice(0, -1);

      io.to(drawingRoomName(identity.sessionId, facts.activeTeam)).emit("drawing:undo");
      ack?.({ ok: true });
    })().catch((error: unknown) => {
      logger.error({ error, socketId: socket.id }, "failed to undo drawing stroke");
      ack?.({ ok: false, error: "INTERNAL_ERROR" });
    });
  });

  socket.on("drawing:clear", (_payload: unknown, ack?: StrokeAck) => {
    void (async () => {
      const facts = await currentDrawingFacts(identity.sessionId);
      if (!facts) return ack?.({ ok: false, error: "NO_DRAWING_GAME" });
      if (facts.phase !== "drawing") return ack?.({ ok: false, error: "WRONG_PHASE" });
      if (identity.role !== facts.activeTeam || identity.displayName !== facts.drawerName) {
        return ack?.({ ok: false, error: "NOT_THE_DRAWER" });
      }
      const buffer = getOrResetBuffer(identity.sessionId, String(facts.currentPromptIndex));
      buffer.strokes = [];

      io.to(drawingRoomName(identity.sessionId, facts.activeTeam)).emit("drawing:clear");
      ack?.({ ok: true });
    })().catch((error: unknown) => {
      logger.error({ error, socketId: socket.id }, "failed to clear drawing canvas");
      ack?.({ ok: false, error: "INTERNAL_ERROR" });
    });
  });

  /**
   * Pull-based, re-checked-live snapshot — the reconnect-recovery story
   * (a socket that just (re)connected, or a fresh Player/Host/Display
   * page mount, calls this once to catch up) AND the reveal story (the
   * opposing team/Display naturally start receiving real strokes here
   * the instant `phase` leaves "drawing" — see mayViewLiveStrokes'
   * comment): no separate "broadcast the reveal" push is needed, callers
   * just ask again once they observe (via the ordinary, unmodified
   * `game:state` broadcast — `phase` is never redacted) that drawing has
   * stopped.
   */
  socket.on("drawing:request-snapshot", (_payload: unknown, ack?: SnapshotAck) => {
    void (async () => {
      const facts = await currentDrawingFacts(identity.sessionId);
      if (!facts) return ack?.({ strokes: [] });
      if (!mayViewLiveStrokes(identity.role, facts)) return ack?.({ strokes: [] });
      const buffer = drawingBuffers.get(identity.sessionId);
      const strokes = buffer && buffer.roundKey === String(facts.currentPromptIndex) ? buffer.strokes : [];
      ack?.({ strokes });
    })().catch((error: unknown) => {
      logger.error({ error, socketId: socket.id }, "failed to read drawing snapshot");
      ack?.({ strokes: [] });
    });
  });

  /** The ONLY way the secret word ever reaches a client — see this file's top comment on why toPublicView alone can't do it (broadcastGameSnapshot is per-ROLE, not per-participant). Re-checked live on every call, which is also the reconnect story: a refreshed drawer just asks again. */
  socket.on("drawing:request-prompt", (_payload: unknown, ack?: PromptAck) => {
    void (async () => {
      const facts = await currentDrawingFacts(identity.sessionId);
      if (!facts || facts.phase !== "drawing" || identity.role !== facts.activeTeam || identity.displayName !== facts.drawerName) {
        return ack?.({ text: null });
      }
      ack?.({ text: facts.prompts[facts.currentPromptIndex]?.text ?? null });
    })().catch((error: unknown) => {
      logger.error({ error, socketId: socket.id }, "failed to read drawing prompt");
      ack?.({ text: null });
    });
  });
}
