/** Which form of a closure travels to a host: the published route, from the
 *  host's Nix, and the sender's staging, from the three Nixes it involves. */

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  asBuiltBecause,
  closureRoute,
  signedBecause,
  stagingRoute,
} from "./closureRoute";

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

describe("stagingRoute", () => {
  const OLD = "2.34.8";
  const NEW = "2.35.6";

  it("over every (nix, this machine's store, the host's store) on either side of 2.35: content-addressed only when all three agree, else the first seat that disagrees", () => {
    const seen: Record<string, unknown> = {};
    for (const cli of [OLD, NEW])
      for (const senderStore of [OLD, NEW])
        for (const targetStore of [OLD, NEW])
          seen[`${cli} ${senderStore} ${targetStore}`] = stagingRoute({
            cli,
            senderStore,
            targetStore,
          });
    const ca = (form: string) => ({ kind: "content-addressed", form });
    const asBuilt = (because: string) => ({ kind: "as-built", because });
    expect(seen).toEqual({
      [`${OLD} ${OLD} ${OLD}`]: ca("2.17"),
      [`${NEW} ${NEW} ${NEW}`]: ca("2.35"),
      // This machine's nix and its own store disagree: nothing it rewrites
      // lands, whatever the host runs (#2368).
      [`${OLD} ${NEW} ${OLD}`]: asBuilt("sender-nix"),
      [`${OLD} ${NEW} ${NEW}`]: asBuilt("sender-nix"),
      [`${NEW} ${OLD} ${OLD}`]: asBuilt("sender-nix"),
      [`${NEW} ${OLD} ${NEW}`]: asBuilt("sender-nix"),
      // This machine agrees with itself; the host does not.
      [`${OLD} ${OLD} ${NEW}`]: asBuilt("target-nix"),
      [`${NEW} ${NEW} ${OLD}`]: asBuilt("target-nix"),
    });
  });

  it("patch levels and later lines of one form are the same form", () => {
    expect(
      stagingRoute({
        cli: "2.34.8",
        senderStore: "2.34.9",
        targetStore: "2.31.2",
      }),
    ).toEqual({ kind: "content-addressed", form: "2.17" });
    expect(
      stagingRoute({
        cli: "2.35.2",
        senderStore: "2.35.6",
        targetStore: "2.36.0",
      }),
    ).toEqual({ kind: "content-addressed", form: "2.35" });
  });

  it("a Nix older than 2.17 anywhere, or a store that reported no version, is the closure sent as built", () => {
    for (const nix of [
      { cli: "2.16.3", senderStore: "2.34.9", targetStore: "2.34.9" },
      { cli: "2.34.8", senderStore: "2.16.3", targetStore: "2.34.9" },
      { cli: "2.34.8", senderStore: "2.34.9", targetStore: "2.16.3" },
      { cli: "2.34.8", senderStore: null, targetStore: "2.34.9" },
      { cli: "2.34.8", senderStore: "2.34.9", targetStore: null },
    ])
      expect(stagingRoute(nix).kind).toBe("as-built");
  });
});

describe("asBuiltBecause", () => {
  it("names both Nixes that disagree", () => {
    expect(
      asBuiltBecause("sender-nix", {
        cli: "2.34.8",
        senderStore: "2.35.6",
        targetStore: "2.34.9",
      }),
    ).toBe(
      "this machine's Nix daemon (2.35.6) does not verify the content-addressed form its nix 2.34.8 writes",
    );
    expect(
      asBuiltBecause("target-nix", {
        cli: "2.35.6",
        senderStore: "2.35.6",
        targetStore: "2.34.9",
      }),
    ).toBe(
      "its Nix 2.34.9 does not verify the content-addressed form this machine's Nix 2.35.6 writes",
    );
  });

  it("never names a version a Nix did not report", () => {
    expect(
      asBuiltBecause("target-nix", {
        cli: "2.34.8",
        senderStore: "2.34.8",
        targetStore: null,
      }),
    ).toBe(
      "its Nix, which reported no version, does not verify the content-addressed form this machine's Nix 2.34.8 writes",
    );
  });
});

describe("the publisher's Nix and the content-addressed lines agree", () => {
  it("a Linux host on the Nix the publish-closure action rewrites with takes the content-addressed form", () => {
    // The action pins its Nix by `install_url`; bumping it past the lines
    // `closureRoute` sends `ca` to would publish a form those hosts refuse.
    const action = readFileSync(
      fileURLToPath(
        new URL(
          "../../../.github/actions/publish-closure/action.yml",
          import.meta.url,
        ),
      ),
      "utf8",
    );
    const version =
      /releases\.nixos\.org\/nix\/nix-(\d+\.\d+\.\d+)\/install/.exec(
        action,
      )?.[1];
    expect(version).toBeDefined();
    expect(closureRoute(linux(version ?? ""), both).kind).toBe(
      "content-addressed",
    );
  });
});
