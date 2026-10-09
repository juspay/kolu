/** The profile listing Settings offers: reading the floor's bundles, and the
 *  boot checks — kolu's default profile leads it, and kolu has plain words for
 *  every profile. (Composing a profile from its two files is
 *  `@kolu/agent-distro/listing`'s, tested there.) */

import type {
  AgentDistroListing,
  AgentDistroProfile,
} from "@kolu/agent-distro/listing";
import { manifestFile } from "@kolu/agent-distro/manifest";
import { profileFile } from "@kolu/agent-distro/profileFile";
import { bundleFiles, readFrom } from "@kolu/agent-distro/testing";
import { AGENT_DISTRO_BUNDLE_ENV } from "@kolu/padi/agentDistroBake";
import { describe, expect, it } from "vitest";
import {
  assertDefaultAgentProfile,
  readAgentDistroListing,
} from "./agentDistroListing.ts";

const BUNDLE = "/nix/store/x-agent-distro-bundle";

const VANILLA: AgentDistroProfile = {
  name: "vanilla",
  description: "Upstream harnesses with your own provider",
  harnesses: [
    { name: "claude", title: "Claude Code", version: "2.1.292" },
    { name: "codex", title: "Codex", version: "0.160.1" },
  ],
};
const JUSPAY: AgentDistroProfile = {
  name: "juspay",
  description: "Juspay skills + Kolu",
  harnesses: [{ name: "claude", title: "Claude Code", version: "2.1.292" }],
};

const LISTING: AgentDistroListing = {
  kind: "available",
  profiles: [VANILLA, JUSPAY],
};

/** The floor on disk: its manifest naming `profiles` in that order, each one's
 *  bundle at `/s/<name>` with its two files. */
const floorFiles = (
  dflt: string,
  profiles: readonly AgentDistroProfile[] = [VANILLA, JUSPAY],
): Record<string, string> =>
  Object.assign(
    {
      [manifestFile(BUNDLE)]: JSON.stringify({
        default: dflt,
        profiles: profiles.map(({ name }) => ({
          name,
          dir: `/s/${name}`,
          bin: `/s/${name}/bin`,
          hash: name,
        })),
      }),
    },
    ...profiles.map((p) => bundleFiles(`/s/${p.name}`, p)),
  );

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
        readFrom(floorFiles("vanilla", [JUSPAY, VANILLA])),
      ),
    ).toThrow(/leads with 'juspay'.*'vanilla'/);
  });

  it("fails the boot when a bundle does not describe itself", () => {
    const files = floorFiles("vanilla");
    delete files[profileFile("/s/juspay")];
    expect(() =>
      readAgentDistroListing(
        { [AGENT_DISTRO_BUNDLE_ENV]: BUNDLE },
        readFrom(files),
      ),
    ).toThrow(/ENOENT: \/s\/juspay\/share\/agent-distro\/profile.json/);
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
