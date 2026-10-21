/** The profile in effect, read off `agent-distro --list --json` with
 *  upstream's own parser and words. */

import { describe, expect, it } from "vitest";
import { parseProfileInEffect } from "./inEffect.ts";

/** Upstream's listing, as its `listing.ts` documents it, cut to one
 *  harness. */
const MENU = {
  harnesses: [
    {
      name: "claude",
      tagline: "Anthropic login",
      title: "Claude Code",
      version: "2.1.291",
    },
  ],
};

describe("parseProfileInEffect", () => {
  it("reads a profile from AI_PROFILE, in upstream's words", () => {
    const profile = {
      description: "Juspay skills + Kolu",
      name: "juspay",
      origin: "/nix/store/p-juspay",
      source: "variable",
    };
    expect(parseProfileInEffect(JSON.stringify({ ...MENU, profile }))).toEqual({
      name: "juspay",
      description: "Juspay skills + Kolu",
      source: "from AI_PROFILE=/nix/store/p-juspay",
    });
  });

  it("names a repository's profile stacked over the AI_PROFILE stack, bottom to top", () => {
    const profile = {
      description: "Ekala's agents",
      name: "ekala",
      origin: "/home/me/ekala-ai-skills/plugin.json",
      source: "repository",
      over: {
        description: "Juspay skills + Kolu",
        name: "juspay",
        origin: "/nix/store/p-juspay",
        source: "variable",
      },
    };
    expect(parseProfileInEffect(JSON.stringify({ ...MENU, profile }))).toEqual({
      name: "juspay + ekala",
      // The TOP profile's description.
      description: "Ekala's agents",
      source:
        "from /home/me/ekala-ai-skills/plugin.json over AI_PROFILE=/nix/store/p-juspay",
    });
  });

  it("a launch with no profile at all names none", () => {
    expect(parseProfileInEffect(JSON.stringify(MENU))).toBeUndefined();
  });

  it("refuses output out of upstream's format, loudly", () => {
    expect(() => parseProfileInEffect("agent-distro picker")).toThrow();
    // The old per-profile menu.
    expect(() =>
      parseProfileInEffect(JSON.stringify({ profiles: [] })),
    ).toThrow();
    // A profile with no name, or an unknown source.
    expect(() =>
      parseProfileInEffect(
        JSON.stringify({
          ...MENU,
          profile: {
            name: "",
            description: "",
            origin: "x",
            source: "variable",
          },
        }),
      ),
    ).toThrow();
    expect(() =>
      parseProfileInEffect(
        JSON.stringify({
          ...MENU,
          profile: { name: "a", description: "", origin: "x", source: "env" },
        }),
      ),
    ).toThrow();
    // A malformed `over` is refused too, not cut off.
    expect(() =>
      parseProfileInEffect(
        JSON.stringify({
          ...MENU,
          profile: {
            name: "a",
            description: "",
            origin: "x",
            source: "repository",
            over: { name: "b" },
          },
        }),
      ),
    ).toThrow();
  });
});
