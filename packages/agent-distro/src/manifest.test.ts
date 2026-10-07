/** The floor manifest the Nix half writes: where it sits, how it parses, and
 *  that a broken one is refused rather than read around. */

import { describe, expect, it } from "vitest";
import defaults from "../defaults.json" with { type: "json" };
import {
  DEFAULT_AGENT_PROFILE,
  manifestFile,
  manifestProfile,
  parseAgentDistroManifest,
} from "./manifest.ts";

const MANIFEST = {
  default: "vanilla",
  picker: "/nix/store/p-agent-distro-picker/bin/agent-distro",
  profiles: [
    {
      name: "vanilla",
      dir: "/nix/store/8rcmf6rd-agent-distro-vanilla-kolu",
      bin: "/nix/store/8rcmf6rd-agent-distro-vanilla-kolu/bin",
      hash: "8rcmf6rd",
    },
  ],
};

describe("the floor manifest", () => {
  it("sits at share/kolu/agent-distro.json inside the bundle", () => {
    expect(manifestFile("/nix/store/f-agent-distro-bundle")).toBe(
      "/nix/store/f-agent-distro-bundle/share/kolu/agent-distro.json",
    );
  });

  it("parses, and names each profile's dir and bin", () => {
    const m = parseAgentDistroManifest(JSON.stringify(MANIFEST));
    expect(m).toEqual(MANIFEST);
    expect(manifestProfile(m, "vanilla")?.bin).toBe(
      "/nix/store/8rcmf6rd-agent-distro-vanilla-kolu/bin",
    );
    expect(manifestProfile(m, "juspay")).toBeUndefined();
  });

  it("refuses a manifest with no profiles, or a missing field", () => {
    expect(() =>
      parseAgentDistroManifest(JSON.stringify({ ...MANIFEST, profiles: [] })),
    ).toThrow();
    const { picker: _picker, ...noPicker } = MANIFEST;
    expect(() => parseAgentDistroManifest(JSON.stringify(noPicker))).toThrow();
  });
});

describe("the default profile", () => {
  it("is typed once, in defaults.json — the file the Nix half reads too", () => {
    expect(DEFAULT_AGENT_PROFILE).toBe(defaults.defaultProfile);
  });
});
