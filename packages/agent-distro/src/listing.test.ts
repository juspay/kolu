/** The listing kolu composes from each floor bundle's two files. */

import { describe, expect, it } from "vitest";
import { floorListing, profileOfBundle } from "./listing.ts";
import type { AgentDistroManifest } from "./manifest.ts";
import { profileFile } from "./profileFile.ts";
import { bundleFiles, readFrom } from "./testing.ts";
import { versionsFile } from "./versions.ts";

const MANIFEST: AgentDistroManifest = {
  default: "vanilla",
  profiles: [
    { name: "vanilla", dir: "/s/v", bin: "/s/v/bin", hash: "v" },
    { name: "juspay", dir: "/s/j", bin: "/s/j/bin", hash: "j" },
  ],
};

const VANILLA = {
  name: "vanilla",
  description: "Upstream harnesses with your own provider",
  harnesses: [
    { name: "claude", title: "Claude Code", version: "2.1.292" },
    { name: "codex", title: "Codex", version: "0.160.1" },
  ],
};
const JUSPAY = {
  name: "juspay",
  description: "Juspay skills + Kolu, via Juspay's LiteLLM gateway",
  harnesses: [{ name: "claude", title: "Claude Code", version: "2.1.292" }],
};

/** Each bundle's files, as upstream writes them. */
const FILES = {
  ...bundleFiles("/s/v", VANILLA),
  ...bundleFiles("/s/j", JUSPAY),
};

/** `FILES` without `path`. */
const without = (path: string): Record<string, string> => {
  const { [path]: _gone, ...rest } = FILES;
  return rest;
};

describe("profileOfBundle", () => {
  it("composes a profile from its profile.json and versions", () => {
    expect(profileOfBundle("vanilla", "/s/v", readFrom(FILES))).toEqual(
      VANILLA,
    );
  });

  it("throws when the bundle describes another profile than the manifest names", () => {
    expect(() => profileOfBundle("juspay", "/s/v", readFrom(FILES))).toThrow(
      /describes profile 'vanilla'.*names it 'juspay'/,
    );
  });

  it("throws when either file is missing — a bundle that does not describe itself is a broken build", () => {
    expect(() =>
      profileOfBundle(
        "vanilla",
        "/s/v",
        readFrom(without(profileFile("/s/v"))),
      ),
    ).toThrow(/ENOENT/);
    expect(() =>
      profileOfBundle(
        "vanilla",
        "/s/v",
        readFrom(without(versionsFile("/s/v"))),
      ),
    ).toThrow(/ENOENT/);
  });

  it("throws on a versions file that names no harness — a profile with no agents is a broken bundle", () => {
    const empty = { ...FILES, [versionsFile("/s/v")]: "" };
    expect(() => profileOfBundle("vanilla", "/s/v", readFrom(empty))).toThrow();
  });
});

describe("floorListing", () => {
  it("keeps the manifest's order — even one that does not lead with its default (kolu-server's boot read refuses that, not this)", () => {
    const juspayFirst: AgentDistroManifest = {
      default: "vanilla",
      profiles: [...MANIFEST.profiles].reverse(),
    };
    expect(floorListing(juspayFirst, readFrom(FILES))).toEqual({
      kind: "available",
      profiles: [JUSPAY, VANILLA],
    });
  });

  it("throws when one bundle names another profile", () => {
    const swapped = {
      ...FILES,
      ...bundleFiles("/s/j", { ...JUSPAY, name: "vanilla" }),
    };
    expect(() => floorListing(MANIFEST, readFrom(swapped))).toThrow(
      /names it 'juspay'/,
    );
  });
});
