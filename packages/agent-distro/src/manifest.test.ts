/** The floor manifest the Nix half writes: where it sits, how it parses, and
 *  that a broken one is refused rather than read around. */

import { describe, expect, it } from "vitest";
import { manifestFile, parseAgentDistroManifest } from "./manifest.ts";

const MANIFEST = {
  dir: "/nix/store/8rcmf6rd-agent-distro",
  bin: "/nix/store/8rcmf6rd-agent-distro/bin",
};

describe("the floor manifest", () => {
  it("sits at share/kolu/agent-distro.json inside the floor", () => {
    expect(manifestFile("/nix/store/f-agent-distro-floor")).toBe(
      "/nix/store/f-agent-distro-floor/share/kolu/agent-distro.json",
    );
  });

  it("parses the one package's dir and bin", () => {
    expect(parseAgentDistroManifest(JSON.stringify(MANIFEST))).toEqual(
      MANIFEST,
    );
  });

  it("refuses a manifest with a missing or empty field", () => {
    const { bin: _, ...noBin } = MANIFEST;
    expect(() => parseAgentDistroManifest(JSON.stringify(noBin))).toThrow();
    expect(() =>
      parseAgentDistroManifest(JSON.stringify({ ...MANIFEST, dir: "" })),
    ).toThrow();
    expect(() => parseAgentDistroManifest("not json")).toThrow();
  });

  it("refuses the old per-profile manifest — a floor of another shape is a broken build", () => {
    expect(() =>
      parseAgentDistroManifest(
        JSON.stringify({
          default: "vanilla",
          profiles: [{ name: "vanilla", ...MANIFEST }],
        }),
      ),
    ).toThrow();
  });
});
