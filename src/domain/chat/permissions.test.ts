import { describe, expect, it } from "vitest";
import { canPostToChannel, channelsForRole } from "./permissions";
import type { ChatChannel, ChatRole } from "./schemas";

const ALL_CHANNELS: ChatChannel[] = ["TEAM_A", "TEAM_B", "PUBLIC"];

describe("channelsForRole", () => {
  it("host joins every channel", () => {
    expect(channelsForRole("HOST")).toEqual(["TEAM_A", "TEAM_B", "PUBLIC"]);
  });

  it("team A joins its own channel and public, not team B", () => {
    expect(channelsForRole("TEAM_A")).toEqual(["TEAM_A", "PUBLIC"]);
  });

  it("team B joins its own channel and public, not team A", () => {
    expect(channelsForRole("TEAM_B")).toEqual(["TEAM_B", "PUBLIC"]);
  });

  it("display only joins public", () => {
    expect(channelsForRole("DISPLAY")).toEqual(["PUBLIC"]);
  });
});

describe("canPostToChannel", () => {
  it("host can post to every channel", () => {
    for (const channel of ALL_CHANNELS) {
      expect(canPostToChannel("HOST", channel)).toBe(true);
    }
  });

  it("display can never post", () => {
    for (const channel of ALL_CHANNELS) {
      expect(canPostToChannel("DISPLAY", channel)).toBe(false);
    }
  });

  it("team A can only post to TEAM_A", () => {
    expect(canPostToChannel("TEAM_A", "TEAM_A")).toBe(true);
    expect(canPostToChannel("TEAM_A", "TEAM_B")).toBe(false);
    expect(canPostToChannel("TEAM_A", "PUBLIC")).toBe(false);
  });

  it("team B can only post to TEAM_B", () => {
    expect(canPostToChannel("TEAM_B", "TEAM_B")).toBe(true);
    expect(canPostToChannel("TEAM_B", "TEAM_A")).toBe(false);
    expect(canPostToChannel("TEAM_B", "PUBLIC")).toBe(false);
  });

  it("every role can only post to channels it's a member of", () => {
    const roles: ChatRole[] = ["HOST", "TEAM_A", "TEAM_B", "DISPLAY"];
    for (const role of roles) {
      const joined = channelsForRole(role);
      for (const channel of ALL_CHANNELS) {
        if (canPostToChannel(role, channel)) {
          expect(joined).toContain(channel);
        }
      }
    }
  });
});
