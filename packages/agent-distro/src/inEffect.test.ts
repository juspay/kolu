/** The profile in effect, read off `agent-distro --list --json`, and the one
 *  test for a profile reference. */

import { describe, expect, it } from "vitest";
import { parseProfileInEffect } from "./inEffect.ts";
import {
  bundleProfileOf,
  isProfileReference,
  REFERENCE_BUNDLE_PROFILE,
} from "./schema.ts";

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

describe("isProfileReference", () => {
  it("a reference has a / or a :; a built-in name has neither", () => {
    expect(isProfileReference("github:me/profile")).toBe(true);
    expect(isProfileReference("git+https://example.com/p")).toBe(true);
    expect(isProfileReference("/home/me/profile")).toBe(true);
    expect(isProfileReference("~/profile")).toBe(true);
    expect(isProfileReference("vanilla")).toBe(false);
    expect(isProfileReference("juspay")).toBe(false);
  });

  it("a reference rides the vanilla bundle; a name its own", () => {
    expect(bundleProfileOf("github:me/profile")).toBe(REFERENCE_BUNDLE_PROFILE);
    expect(REFERENCE_BUNDLE_PROFILE).toBe("vanilla");
    expect(bundleProfileOf("juspay")).toBe("juspay");
  });
});
