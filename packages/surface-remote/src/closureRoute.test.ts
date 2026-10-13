/** Which form of a published closure a host pulls, from its Nix. */

import { describe, expect, it } from "vitest";
import { closureRoute, signedBecause } from "./closureRoute";

const IA = "/nix/store/1xxnk4wx89kk1cfyfnqgz8hg5msbz0gw-agent-distro-vanilla";
const CA = "/nix/store/r6r8xkl3fvi5is4ckfbl6sl1wacz2rak-agent-distro-vanilla";
const both = { rev: "f".repeat(40), ia: IA, ca: CA };
const linux = (nixVersion: string) => ({ system: "x86_64-linux", nixVersion });

describe("closureRoute", () => {
  it("a Linux Nix 2.17 through 2.34 pulls the content-addressed bundle", () => {
    for (const v of [
      "2.17.0",
      "2.24.15",
      "2.34.8",
      "2.34.99pre20261013_abcdef",
    ])
      expect(closureRoute(linux(v), both)).toEqual({
        kind: "content-addressed",
        storePath: CA,
      });
  });

  it("a Linux Nix outside that line pulls the signed bundle, because of its Nix line", () => {
    for (const v of ["2.35.0", "2.35.2", "2.40.1", "3.0.0", "2.16.3"])
      expect(closureRoute(linux(v), both)).toEqual({
        kind: "signed",
        storePath: IA,
        because: "nix-line",
      });
  });

  it("a Mac pulls the signed bundle whatever its Nix, because of Mach-O signatures — and needs no `ca`", () => {
    const { ca: _, ...darwinEntry } = both;
    for (const v of ["2.34.8", "2.35.1"])
      expect(
        closureRoute({ system: "aarch64-darwin", nixVersion: v }, darwinEntry),
      ).toEqual({ kind: "signed", storePath: IA, because: "mach-o" });
  });

  it("a Linux host that would pull `ca` from an entry without one is loud", () => {
    const { ca: _, ...noCa } = both;
    expect(() => closureRoute(linux("2.34.8"), noCa)).toThrow(
      "the closure index names no content-addressed closure for x86_64-linux",
    );
  });

  it("a Nix version with no major.minor is loud", () => {
    expect(() => closureRoute(linux("unknown"), both)).toThrow(
      /names no major\.minor/,
    );
  });
});

describe("signedBecause", () => {
  it("names the reason a host was sent the signed bundle", () => {
    expect(
      signedBecause("mach-o", {
        system: "aarch64-darwin",
        nixVersion: "2.35.1",
      }),
    ).toMatch(/code signature/);
    expect(signedBecause("nix-line", linux("2.35.2"))).toBe(
      "its Nix 2.35.2 cannot verify the content-addressed form the publisher writes (written by Nix 2.34; Nix 2.17 through 2.34 can)",
    );
  });
});
