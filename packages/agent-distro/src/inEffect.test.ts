/** The profile in effect, read off `agent-distro --list --json`, and the
 *  bundle a profile rides. */

import { describe, expect, it } from "vitest";
import { parseProfileInEffect } from "./inEffect.ts";
import { DEFAULT_AGENT_PROFILE } from "./manifest.ts";
import { bundleProfileOf } from "./schema.ts";

/** Upstream's listing, as its `src/listing.ts` documents it, cut to one
 *  harness. */
const MENU = {
  profiles: [
    {
      description: "Upstream harnesses with your own provider",
      harnesses: [
        {
          name: "claude",
          tagline: "Anthropic login",
          title: "Claude Code",
          version: "2.1.291",
        },
      ],
      name: "vanilla",
    },
  ],
};

describe("parseProfileInEffect", () => {
  it("reads the profile in effect and where it came from", () => {
    const profile = {
      description: "Ekala's agents",
      name: "ekala",
      origin: "/home/me/ekala/agent-distro.nix",
      source: "repository",
    };
    // `source` is upstream's to grow; kolu reads only what the pill shows.
    const { source: _, ...read } = profile;
    expect(parseProfileInEffect(JSON.stringify({ ...MENU, profile }))).toEqual(
      read,
    );
  });

  it("a bundle older than profile references names none", () => {
    expect(parseProfileInEffect(JSON.stringify(MENU))).toBeUndefined();
  });

  it("refuses output out of upstream's format, loudly", () => {
    expect(() => parseProfileInEffect("agent-distro picker")).toThrow();
    expect(() =>
      parseProfileInEffect(
        JSON.stringify({
          ...MENU,
          profile: {
            name: "",
            description: "",
            origin: "x",
          },
        }),
      ),
    ).toThrow();
  });
});

describe("bundleProfileOf", () => {
  const bundles = new Set(["vanilla", "juspay"]);
  it("a shipped bundle's name rides its own bundle; anything else the default one", () => {
    expect(bundleProfileOf("juspay", bundles)).toBe("juspay");
    expect(bundleProfileOf("github:me/profile", bundles)).toBe(
      DEFAULT_AGENT_PROFILE,
    );
    expect(bundleProfileOf("~/profile", bundles)).toBe(DEFAULT_AGENT_PROFILE);
    // A bare name kolu does not ship is agent-distro's to refuse, in a terminal.
    expect(bundleProfileOf("ekala", bundles)).toBe(DEFAULT_AGENT_PROFILE);
  });
});
