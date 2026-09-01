import type { GuessThePriceConfig } from "./types";

/**
 * FIXTURE DATA — not real show content, same posture as
 * steamRatings/fixtures.ts's sampleSteamRatingsPlaylist. Two rounds is
 * enough to exercise a full guessing -> buzz -> answer -> judge ->
 * reveal -> next round cycle (plus a steal) in engine.test.ts without a
 * long playlist.
 *
 * `imageUrl` MUST be a file that genuinely exists under
 * public/images/price — this is what `game.start` actually snapshots
 * into a live SessionGame when the Host picks "Default Guess the Price"
 * (no playlist selected), so a placeholder path here would be a REAL
 * broken image on Player/Host/Display, not just an unused fixture (see
 * steamRatings/fixtures.ts's own doc comment on the exact bug class this
 * guards against). The bundled file is a locally-generated placeholder
 * product photo (no real product photography ships with this repo),
 * reused at two different "rounds" the same way SteamRatings' own sample
 * reuses its one bundled cover twice.
 */
export const sampleGuessThePricePlaylist: GuessThePriceConfig = {
  rounds: [
    {
      id: "round-1",
      title: "Sample Gadget",
      imageUrl: "/images/price/sample-item.png",
      price: 49.99,
      marginPercent: 10,
    },
    {
      id: "round-2",
      title: "Sample Gadget (deluxe)",
      imageUrl: "/images/price/sample-item.png",
      price: 129,
    },
  ],
};
