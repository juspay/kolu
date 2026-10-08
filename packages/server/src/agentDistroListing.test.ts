/** The profile listing Settings offers: reading the floor's bundles, and the
 *  boot checks — kolu's default profile leads it, and kolu has plain words for
 *  every profile. (Composing a profile from its two files is
 *  `@kolu/agent-distro/listing`'s, tested there.) */

import type { AgentDistroListing } from "@kolu/agent-distro/listing";
import { AGENT_DISTRO_BUNDLE_ENV } from "@kolu/padi/agentDistroBake";
import { describe, expect, it } from "vitest";
import {
  assertDefaultAgentProfile,
  assertPlainProfiles,
  readAgentDistroListing,
} from "./agentDistroListing.ts";

const BUNDLE = "/nix/store/x-agent-distro-bundle";

/** The floor on disk: its manifest, and each profile bundle's two files. */
const floorFiles = (
  dflt: string,
  order: readonly string[] = ["vanilla", "juspay"],
): Record<string, string> => ({
  [`${BUNDLE}/share/kolu/agent-distro.json`]: JSON.stringify({
    default: dflt,
    profiles: order.map((name) => ({
      name,
      dir: `/s/${name}`,
      bin: `/s/${name}/bin`,
      hash: name,
    })),
  }),
  "/s/vanilla/share/agent-distro/profile.json":
    '{"description":"Upstream harnesses with your own provider","name":"vanilla"}',
  "/s/vanilla/share/agent-distro/versions":
    "claude\tClaude Code\t2.1.292\ncodex\tCodex\t0.160.1\n",
  "/s/juspay/share/agent-distro/profile.json":
    '{"description":"Juspay skills + Kolu","name":"juspay"}',
  "/s/juspay/share/agent-distro/versions": "claude\tClaude Code\t2.1.292\n",
});

const readFrom =
  (files: Record<string, string>) =>
  (path: string): string => {
    const text = files[path];
    if (text === undefined) throw new Error(`unexpected read ${path}`);
    return text;
  };

const LISTING: AgentDistroListing = {
  kind: "available",
  profiles: [
    {
      name: "vanilla",
      description: "Upstream harnesses with your own provider",
      harnesses: [
        { name: "claude", title: "Claude Code", version: "2.1.292" },
        { name: "codex", title: "Codex", version: "0.160.1" },
      ],
    },
    {
      name: "juspay",
      description: "Juspay skills + Kolu",
      harnesses: [{ name: "claude", title: "Claude Code", version: "2.1.292" }],
    },
  ],
};

describe("readAgentDistroListing", () => {
  it("unbaked → unavailable, and nothing is read", () => {
    let read = false;
    expect(
      readAgentDistroListing({}, () => {
        read = true;
        return "";
      }),
    ).toEqual({ kind: "unavailable" });
    expect(read).toBe(false);
  });

  it("baked → each floor profile read off its own bundle, in the manifest's order", () => {
    expect(
      readAgentDistroListing(
        { [AGENT_DISTRO_BUNDLE_ENV]: BUNDLE },
        readFrom(floorFiles("vanilla")),
      ),
    ).toEqual(LISTING);
  });

  it("fails the boot when the manifest does not lead with its default", () => {
    expect(() =>
      readAgentDistroListing(
        { [AGENT_DISTRO_BUNDLE_ENV]: BUNDLE },
        readFrom(floorFiles("vanilla", ["juspay", "vanilla"])),
      ),
    ).toThrow(/leads with 'juspay'.*'vanilla'/);
  });

  it("fails the boot on a profile kolu has no plain words for — the boot read carries every check", () => {
    const files = floorFiles("vanilla", ["vanilla", "mystery"]);
    files["/s/mystery/share/agent-distro/profile.json"] =
      '{"description":"m","name":"mystery"}';
    files["/s/mystery/share/agent-distro/versions"] =
      "claude\tClaude Code\t1\n";
    expect(() =>
      readAgentDistroListing(
        { [AGENT_DISTRO_BUNDLE_ENV]: BUNDLE },
        readFrom(files),
      ),
    ).toThrow(/PROFILE_PLAIN/);
  });

  it("fails the boot when a bundle does not describe itself", () => {
    const files = floorFiles("vanilla");
    delete files["/s/juspay/share/agent-distro/profile.json"];
    expect(() =>
      readAgentDistroListing(
        { [AGENT_DISTRO_BUNDLE_ENV]: BUNDLE },
        readFrom(files),
      ),
    ).toThrow(/unexpected read \/s\/juspay\/share\/agent-distro\/profile.json/);
  });
});

describe("assertDefaultAgentProfile", () => {
  it("passes when the listing leads with kolu's default, and when unbaked", () => {
    expect(assertDefaultAgentProfile(LISTING, "vanilla")).toBe(LISTING);
    expect(
      assertDefaultAgentProfile({ kind: "unavailable" }, "vanilla"),
    ).toEqual({ kind: "unavailable" });
  });

  it("fails the boot when the two defaults disagree", () => {
    expect(() => assertDefaultAgentProfile(LISTING, "juspay")).toThrow(
      /leads with 'vanilla'.*'juspay'/,
    );
  });
});

describe("assertPlainProfiles", () => {
  it("passes when kolu can describe every profile in plain words, and when unbaked", () => {
    expect(assertPlainProfiles(LISTING)).toBe(LISTING);
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
