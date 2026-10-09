/** The profile in effect, read off `agent-distro --list --json`, its failure
 *  in one line, and the bundle a profile rides. */

import { describe, expect, it } from "vitest";
import { listJsonFailureLine, parseProfileInEffect } from "./inEffect.ts";
import { bundleProfileOf, REFERENCE_BUNDLE_PROFILE } from "./schema.ts";

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
  it("a shipped bundle's name rides its own bundle; anything else the vanilla one", () => {
    expect(bundleProfileOf("juspay", bundles)).toBe("juspay");
    expect(bundleProfileOf("github:me/profile", bundles)).toBe(
      REFERENCE_BUNDLE_PROFILE,
    );
    expect(bundleProfileOf("~/profile", bundles)).toBe(
      REFERENCE_BUNDLE_PROFILE,
    );
    // A bare name kolu does not ship is agent-distro's to refuse, in a terminal.
    expect(bundleProfileOf("ekala", bundles)).toBe(REFERENCE_BUNDLE_PROFILE);
    expect(REFERENCE_BUNDLE_PROFILE).toBe("vanilla");
  });
});

describe("listJsonFailureLine", () => {
  it("agent-distro's words on one line, without its prefix or the variable's label", () => {
    expect(
      listJsonFailureLine(
        [
          "agent-distro: AI_PROFILE=github:nobody/nothing: cannot fetch github:nobody/nothing:",
          "error:",
          "       … while fetching the input 'github:nobody/nothing'",
          "",
          "       error: unable to download 'https://api.github.com/repos/nobody/nothing/commits/HEAD': HTTP error 404",
          "",
        ].join("\n"),
        "github:nobody/nothing",
      ),
    ).toBe(
      "cannot fetch github:nobody/nothing: … while fetching the input 'github:nobody/nothing' unable to download 'https://api.github.com/repos/nobody/nothing/commits/HEAD': HTTP error 404",
    );
  });

  it("a bare name upstream does not know", () => {
    expect(
      listJsonFailureLine(
        "agent-distro: AI_PROFILE=ekala: not a built-in profile (vanilla) or a reference: a path starting with /, ./ or ../, or a flake reference such as github:owner/repo\n",
        "ekala",
      ),
    ).toBe(
      "not a built-in profile (vanilla) or a reference: a path starting with /, ./ or ../, or a flake reference such as github:owner/repo",
    );
  });

  it("an empty stderr says so", () => {
    expect(listJsonFailureLine("\n", "x")).toBe(
      "agent-distro failed and said nothing",
    );
  });
});
