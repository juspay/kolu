/** The listing kolu composes from each floor bundle's two files. */

import { describe, expect, it } from "vitest";
import { floorListing, profileOfBundle } from "./listing.ts";
import type { AgentDistroManifest } from "./manifest.ts";

const MANIFEST: AgentDistroManifest = {
  default: "vanilla",
  profiles: [
    { name: "vanilla", dir: "/s/v", bin: "/s/v/bin", hash: "v" },
    { name: "juspay", dir: "/s/j", bin: "/s/j/bin", hash: "j" },
  ],
};

/** Each bundle's files, as upstream writes them. */
const FILES: Record<string, string> = {
  "/s/v/share/agent-distro/profile.json":
    '{"description":"Upstream harnesses with your own provider","name":"vanilla"}',
  "/s/v/share/agent-distro/versions":
    "claude\tClaude Code\t2.1.292\ncodex\tCodex\t0.160.1\n",
  "/s/j/share/agent-distro/profile.json":
    '{"description":"Juspay skills + Kolu, via Juspay\'s LiteLLM gateway","name":"juspay"}',
  "/s/j/share/agent-distro/versions": "claude\tClaude Code\t2.1.292\n",
};

const readFrom =
  (files: Record<string, string>) =>
  (path: string): string => {
    const text = files[path];
    if (text === undefined) throw new Error(`ENOENT: ${path}`);
    return text;
  };

describe("profileOfBundle", () => {
  it("composes a profile from its profile.json and versions", () => {
    expect(profileOfBundle("vanilla", "/s/v", readFrom(FILES))).toEqual({
      name: "vanilla",
      description: "Upstream harnesses with your own provider",
      harnesses: [
        { name: "claude", title: "Claude Code", version: "2.1.292" },
        { name: "codex", title: "Codex", version: "0.160.1" },
      ],
    });
  });

  it("throws when the bundle describes another profile than the manifest names", () => {
    expect(() => profileOfBundle("juspay", "/s/v", readFrom(FILES))).toThrow(
      /describes profile 'vanilla'.*names it 'juspay'/,
    );
  });

  it("throws when either file is missing — a bundle that does not describe itself is a broken build", () => {
    const { "/s/v/share/agent-distro/profile.json": _p, ...noProfile } = FILES;
    expect(() =>
      profileOfBundle("vanilla", "/s/v", readFrom(noProfile)),
    ).toThrow(/ENOENT/);
    const { "/s/v/share/agent-distro/versions": _v, ...noVersions } = FILES;
    expect(() =>
      profileOfBundle("vanilla", "/s/v", readFrom(noVersions)),
    ).toThrow(/ENOENT/);
  });
});

describe("floorListing", () => {
  it("lists every floor profile in the manifest's order, the default first", () => {
    const listing = floorListing(MANIFEST, readFrom(FILES));
    expect(listing.kind).toBe("available");
    if (listing.kind !== "available") return;
    expect(listing.profiles.map((p) => p.name)).toEqual(["vanilla", "juspay"]);
    expect(listing.profiles[0]?.name).toBe(MANIFEST.default);
    expect(listing.profiles[1]?.harnesses).toEqual([
      { name: "claude", title: "Claude Code", version: "2.1.292" },
    ]);
  });

  it("throws when one bundle names another profile", () => {
    const swapped = {
      ...FILES,
      "/s/j/share/agent-distro/profile.json":
        '{"description":"d","name":"vanilla"}',
    };
    expect(() => floorListing(MANIFEST, readFrom(swapped))).toThrow(
      /names it 'juspay'/,
    );
  });
});
