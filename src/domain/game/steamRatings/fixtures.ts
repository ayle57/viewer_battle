import type { SteamRatingsConfig } from "./types";

/**
 * FIXTURE DATA — not real show content, same posture as
 * music/fixtures.ts's sampleMusicPlaylist. Two rounds is enough to
 * exercise a full guessing -> reveal -> buzz -> answer -> judge ->
 * reveal -> next round cycle (plus a steal) in engine.test.ts without a
 * long playlist.
 *
 * `imageUrl` MUST be a file that genuinely exists under
 * public/images/steam — this is what `game.start` actually snapshots
 * into a live SessionGame when the Host picks "Default Guess the Game"
 * (no playlist selected), so a placeholder path here would be a REAL
 * broken image on Player/Host/Display, not just an unused fixture (see
 * music/fixtures.ts's own doc comment on the exact bug class this
 * guards against). The bundled file is a locally-generated placeholder
 * capsule image (no real Steam/game assets ship with this repo), reused
 * at two different "rounds" the same way Music's own sample reuses its
 * one bundled clip twice.
 */
export const sampleSteamRatingsPlaylist: SteamRatingsConfig = {
  rounds: [
    {
      id: "round-1",
      title: "Sample Game",
      imageUrl: "/images/steam/sample-cover.png",
      ratings: [
        "\"An experience.\"",
        "\"10/10 would recommend to a friend I don't like.\"",
        "\"I have never clicked so many buttons in my life.\"",
      ],
    },
    {
      id: "round-2",
      title: "Sample Game (again)",
      imageUrl: "/images/steam/sample-cover.png",
      ratings: [
        "\"Peak fiction.\"",
        "\"My cat walked across the keyboard and did better than me.\"",
        "\"It's basically that other game, but this one has a dog.\"",
      ],
    },
  ],
};
