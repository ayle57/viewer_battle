import { describe, expect, it } from "vitest";
import { toRosterSeats } from "./roster";

/**
 * The real bug this file exists to lock down: a participant who JUST
 * joined is known instantly via `presence:update` (the real-time
 * socket push), but `toRosterSeats` used to render seats ONLY from the
 * polled `session.getState` roster (up to ~2s stale) — confirmed
 * directly, a real join showed "Empty seat" on the Host's own Lobby
 * 150ms later. `presence` already carries everything needed
 * (`participantId`/`displayName`/`role`) to render that seat
 * immediately instead of waiting out the poll.
 */
describe("toRosterSeats", () => {
  it("shows a seat from the polled roster as connected when presence confirms it", () => {
    const seats = toRosterSeats(
      [{ id: "p1", displayName: "Nova" }],
      [{ participantId: "p1", role: "TEAM_A", displayName: "Nova" }],
      "TEAM_A",
    );
    expect(seats).toEqual([{ id: "p1", displayName: "Nova", connected: true }]);
  });

  it("shows a seat from the polled roster as NOT connected when presence doesn't have them (a real disconnect)", () => {
    const seats = toRosterSeats([{ id: "p1", displayName: "Nova" }], [], "TEAM_A");
    expect(seats).toEqual([{ id: "p1", displayName: "Nova", connected: false }]);
  });

  it("the real bug this file locks down: folds in a participant who's present but not yet in the polled roster, instead of rendering them as an empty seat", () => {
    const seats = toRosterSeats(
      [], // the poll hasn't caught up yet — this is the exact staleness window that was reproduced
      [{ participantId: "p2", role: "TEAM_B", displayName: "Zeke" }],
      "TEAM_B",
    );
    expect(seats).toEqual([{ id: "p2", displayName: "Zeke", connected: true }]);
  });

  it("never folds in a presence entry for a DIFFERENT role — a team's own roster stays scoped to that team", () => {
    const seats = toRosterSeats(
      [],
      [
        { participantId: "host-1", role: "HOST", displayName: "Coach" },
        { participantId: "display-1", role: "DISPLAY", displayName: "OBS" },
        { participantId: "b-1", role: "TEAM_B", displayName: "Zeke" },
      ],
      "TEAM_A",
    );
    expect(seats).toEqual([]);
  });

  it("never double-lists someone who's in BOTH the polled roster and presence", () => {
    const seats = toRosterSeats(
      [{ id: "p1", displayName: "Nova" }],
      [{ participantId: "p1", role: "TEAM_A", displayName: "Nova" }],
      "TEAM_A",
    );
    expect(seats).toHaveLength(1);
  });
});
