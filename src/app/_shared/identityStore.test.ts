import { beforeEach, describe, expect, it } from "vitest";
import { useIdentityStore } from "./identityStore";

/**
 * Plain vitest, no DOM/React — same posture as gameStore.test.ts's own
 * doc comment on why a Zustand store is testable directly.
 *
 * The real bug this file exists to lock down: `updateSessionCode` is the
 * client-side half of the fix for a session-code-rotation bug found via
 * real browser testing — an already-connected participant's own
 * `session.getState` polling used a stale `identity.sessionCode`
 * forever after the Host rotated it (self-service, or automatically as
 * part of a kick), 404ing and getting misread as the whole session
 * having ended even though it was completely alive (see
 * broadcastSessionCodeRotated's own doc comment, server/sockets/
 * session.ts, for the server-side half). This locks down the one thing
 * this store itself is responsible for: updating the code IN PLACE,
 * without disturbing anything else about the identity, and never
 * resurrecting an identity that's already gone.
 */
describe("identityStore.updateSessionCode()", () => {
  beforeEach(() => {
    useIdentityStore.getState().clearIdentity();
  });

  it("updates sessionCode in place, leaving role/displayName/token untouched", () => {
    useIdentityStore.getState().setIdentity({ sessionCode: "OLDCODE", role: "TEAM_A", displayName: "Nova", token: "tok-1" });

    useIdentityStore.getState().updateSessionCode("NEWCODE");

    expect(useIdentityStore.getState().identity).toEqual({
      sessionCode: "NEWCODE",
      role: "TEAM_A",
      displayName: "Nova",
      token: "tok-1",
    });
  });

  it("is a no-op when there's no identity to update — never resurrects a cleared identity", () => {
    expect(useIdentityStore.getState().identity).toBeNull();

    useIdentityStore.getState().updateSessionCode("NEWCODE");

    expect(useIdentityStore.getState().identity).toBeNull();
  });
});
