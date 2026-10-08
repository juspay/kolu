/** The profile listing Settings offers: running the baked picker, and the boot
 *  check that kolu's default profile leads it. (Parsing `--list --json` is
 *  `@kolu/agent-distro/listing`'s, tested there.) */

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
      picker: "/nix/store/p-picker/bin/agent-distro",
      profiles: [
        { name: "vanilla", dir: "/s/v", bin: "/s/v/bin", hash: "v" },
        { name: "juspay", dir: "/s/j", bin: "/s/j/bin", hash: "j" },
      ],
    });
  const readManifest = (dflt: string) => (path: string) => {
    if (path !== `${BUNDLE}/share/kolu/agent-distro.json`)
      throw new Error(`unexpected read ${path}`);
    return manifest(dflt);
  };

  it("baked → runs the picker the floor's manifest names, with --list --json", () => {
    const calls: string[][] = [];
    const listing = readAgentDistroListing(
      { [AGENT_DISTRO_BUNDLE_ENV]: BUNDLE },
      (bin, args) => {
        calls.push([bin, ...args]);
        return FIXTURE;
      },
      readManifest("vanilla"),
    );
    expect(calls).toEqual([
      ["/nix/store/p-picker/bin/agent-distro", "--list", "--json"],
    ]);
    expect(listing.kind).toBe("available");
  });

  it("fails the boot when the picker does not lead with the manifest's default", () => {
    expect(() =>
      readAgentDistroListing(
        { [AGENT_DISTRO_BUNDLE_ENV]: BUNDLE },
        () => FIXTURE,
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
