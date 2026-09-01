import type { DrawingConfig } from "./types";

/**
 * FIXTURE DATA — not real show content, same posture as
 * boardQuestion/fixtures.ts's sampleBoard and geoGuessr/fixtures.ts's
 * sampleGeoPlaylist. A handful of prompts is enough to exercise a full
 * choose-drawer -> draw -> guess -> judge -> next-turn cycle in
 * engine.test.ts, and to give /dev/game and Content Studio's "sample"
 * start mode something real to play with, without needing a Playlist.
 */
export const sampleDrawingPlaylist: DrawingConfig = {
  prompts: [
    { id: "prompt-1", text: "Caterpillar", durationSeconds: 30 },
    { id: "prompt-2", text: "Dragon", durationSeconds: 30 },
    { id: "prompt-3", text: "Astronaut", durationSeconds: 45 },
    { id: "prompt-4", text: "Pirate", durationSeconds: 30 },
    { id: "prompt-5", text: "Witch", durationSeconds: 60 },
    { id: "prompt-6", text: "Robot", durationSeconds: 30 },
    { id: "prompt-7", text: "Knight", durationSeconds: 30 },
    { id: "prompt-8", text: "Mermaid", durationSeconds: 45 },
  ],
};
