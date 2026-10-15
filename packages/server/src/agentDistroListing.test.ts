/** The harnesses Settings shows: read off the floor's package, as its
 *  manifest names it, with every boot check applied. (Reading a versions file
 *  is upstream's parser, behind `@kolu/agent-distro/listing`, tested there.) */

import type { AgentVersion } from "@kolu/agent-distro/listing";
import { versionsFile } from "@kolu/agent-distro/bundle";
import { manifestFile } from "@kolu/agent-distro/manifest";
import { packageFiles, readFrom } from "@kolu/agent-distro/testing";
import { AGENT_DISTRO_BUNDLE_ENV } from "@kolu/padi/agentDistroBake";
import { describe, expect, it } from "vitest";
import { readAgentDistroListing } from "./agentDistroListing.ts";

const FLOOR = "/nix/store/x-agent-distro-floor";
const PACKAGE = "/nix/store/y-agent-distro";

const HARNESSES: readonly AgentVersion[] = [
  { name: "claude", title: "Claude Code", version: "2.1.292" },
  { name: "codex", title: "Codex", version: "0.160.1" },
];

/** The floor on disk: its manifest naming the package, and the package's
 *  versions file. */
const floorFiles = (
  harnesses: readonly AgentVersion[] = HARNESSES,
): Record<string, string> => ({
  [manifestFile(FLOOR)]: JSON.stringify({
    dir: PACKAGE,
    bin: `${PACKAGE}/bin`,
  }),
  ...packageFiles(PACKAGE, harnesses),
});

const baked = { [AGENT_DISTRO_BUNDLE_ENV]: FLOOR };

describe("readAgentDistroListing", () => {
  it("unbaked → unavailable, and nothing is read", () => {
    let read = false;
    expect(
      readAgentDistroListing({}, () => {
        read = true;
        return "";
      }),
    ).toEqual({ kind: "unavailable" });
    expect(readAgentDistroListing({ [AGENT_DISTRO_BUNDLE_ENV]: "" })).toEqual({
      kind: "unavailable",
    });
    expect(read).toBe(false);
  });

  it("baked → the package's harnesses, in its versions file's order", () => {
    expect(readAgentDistroListing(baked, readFrom(floorFiles()))).toEqual({
      kind: "available",
      harnesses: HARNESSES,
    });
  });

  it("fails the boot when the package does not list its harnesses", () => {
    const files = floorFiles();
    delete files[versionsFile(PACKAGE)];
    expect(() => readAgentDistroListing(baked, readFrom(files))).toThrow(
      `ENOENT: ${versionsFile(PACKAGE)}`,
    );
  });

  it("fails the boot when the package lists no harness", () => {
    expect(() =>
      readAgentDistroListing(baked, readFrom(floorFiles([]))),
    ).toThrow();
  });

  it("fails the boot on a manifest that is not one", () => {
    expect(() =>
      readAgentDistroListing(
        baked,
        readFrom({
          ...floorFiles(),
          [manifestFile(FLOOR)]: JSON.stringify({ default: "vanilla" }),
        }),
      ),
    ).toThrow();
  });
});
