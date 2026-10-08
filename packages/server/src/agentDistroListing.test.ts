/** The profile listing Settings offers: running each floor profile's own
 *  picker, and the boot check that kolu's default profile leads it. (Parsing
 *  `--list --json` is `@kolu/agent-distro/listing`'s, tested there.) */

import { AGENT_DISTRO_BUNDLE_ENV } from "@kolu/padi/agentDistroBake";
import { describe, expect, it } from "vitest";
import { parseAgentDistroList } from "@kolu/agent-distro/listing";
import {
  assertDefaultAgentProfile,
  assertPlainProfiles,
  readAgentDistroListing,
} from "./agentDistroListing.ts";

const FIXTURE = JSON.stringify({
  profiles: [
    {
      name: "vanilla",
      description: "Upstream harnesses with your own provider",
      harnesses: [
        {
          name: "claude",
          title: "Claude Code",
          tagline: "Anthropic login · plugin dirs per session",
          version: "2.1.286",
        },
        { name: "codex", title: "Codex", tagline: "OpenAI", version: "0.42.0" },
      ],
    },
    {
      name: "juspay",
      description: "Juspay skills + Kolu, via Juspay's LiteLLM gateway",
      harnesses: [],
    },
  ],
});

describe("readAgentDistroListing", () => {
  it("unbaked → unavailable, and nothing is run", () => {
    let ran = false;
    expect(
      readAgentDistroListing({}, () => {
        ran = true;
        return FIXTURE;
      }),
    ).toEqual({ kind: "unavailable" });
    expect(ran).toBe(false);
  });

  const BUNDLE = "/nix/store/x-agent-distro-bundle";
  const manifest = (dflt: string) =>
    JSON.stringify({
      default: dflt,
      profiles: ["vanilla", "juspay"].map((name) => ({
        name,
        dir: `/s/${name}`,
        bin: `/s/${name}/bin`,
        hash: name,
      })),
    });
  // Each profile's own picker lists exactly that profile.
  const PROFILES = JSON.parse(FIXTURE).profiles as { name: string }[];
  const pickers = (bin: string) => {
    const name = bin.match(/^\/s\/(\w+)\/bin\/agent-distro$/)?.[1];
    const profile = PROFILES.find((p) => p.name === name);
    if (profile === undefined) throw new Error(`unexpected run ${bin}`);
    return JSON.stringify({ profiles: [profile] });
  };
  const readManifest = (dflt: string) => (path: string) => {
    if (path !== `${BUNDLE}/share/kolu/agent-distro.json`)
      throw new Error(`unexpected read ${path}`);
    return manifest(dflt);
  };

  it("baked → Settings lists EVERY manifest profile, the default first: each profile's own picker run off its bin with --list --json, joined in the manifest's order", () => {
    const calls: string[][] = [];
    const listing = readAgentDistroListing(
      { [AGENT_DISTRO_BUNDLE_ENV]: BUNDLE },
      (bin, args) => {
        calls.push([bin, ...args]);
        return pickers(bin);
      },
      readManifest("vanilla"),
    );
    expect(calls).toEqual([
      ["/s/vanilla/bin/agent-distro", "--list", "--json"],
      ["/s/juspay/bin/agent-distro", "--list", "--json"],
    ]);
    // Each picker lists only its own profile; the joined listing has them all.
    expect(
      listing.kind === "available" ? listing.profiles.map((p) => p.name) : [],
    ).toEqual(["vanilla", "juspay"]);
    expect(listing).toEqual(parseAgentDistroList(FIXTURE));
  });

  it("fails the boot when a profile's picker lists anything but that profile", () => {
    expect(() =>
      readAgentDistroListing(
        { [AGENT_DISTRO_BUNDLE_ENV]: BUNDLE },
        () => FIXTURE,
        readManifest("vanilla"),
      ),
    ).toThrow(/not exactly 'vanilla'/);
  });

  it("fails the boot when the listing does not lead with the manifest's default", () => {
    expect(() =>
      readAgentDistroListing(
        { [AGENT_DISTRO_BUNDLE_ENV]: BUNDLE },
        pickers,
        readManifest("juspay"),
      ),
    ).toThrow(/leads with 'vanilla'.*'juspay'/);
  });
});

describe("assertDefaultAgentProfile", () => {
  it("passes when the listing leads with kolu's default, and when unbaked", () => {
    const listing = parseAgentDistroList(FIXTURE);
    expect(assertDefaultAgentProfile(listing, "vanilla")).toBe(listing);
    expect(
      assertDefaultAgentProfile({ kind: "unavailable" }, "vanilla"),
    ).toEqual({ kind: "unavailable" });
  });

  it("fails the boot when the two defaults disagree", () => {
    expect(() =>
      assertDefaultAgentProfile(parseAgentDistroList(FIXTURE), "juspay"),
    ).toThrow(/leads with 'vanilla'.*'juspay'/);
  });
});

describe("assertPlainProfiles", () => {
  it("passes when kolu can describe every profile in plain words, and when unbaked", () => {
    const listing = parseAgentDistroList(FIXTURE);
    expect(assertPlainProfiles(listing)).toBe(listing);
    expect(assertPlainProfiles({ kind: "unavailable" })).toEqual({
      kind: "unavailable",
    });
  });

  it("fails the boot on a profile kolu has no words for", () => {
    expect(() =>
      assertPlainProfiles({
        kind: "available",
        profiles: [{ name: "mystery", description: "m", harnesses: [] }],
      }),
    ).toThrow(/PROFILE_PLAIN/);
  });
});
