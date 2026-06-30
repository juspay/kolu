import { isContractVersionCompatible } from "@kolu/surface/define";
import { describe, expect, it } from "vitest";
import { seedSnapshot } from "./index.ts";
import { TerminalSnapshotSchema } from "./schema.ts";
import {
  DEFAULT_VERSION,
  TERMINAL_WORKSPACE_CONTRACT_VERSION,
  terminalWorkspaceSurface,
  VersionSchema,
} from "./surface.ts";

describe("terminal-workspace surface", () => {
  it("builds the workspace surface contract", () => {
    expect(terminalWorkspaceSurface.contract).toBeTruthy();
  });

  it("DEFAULT_VERSION carries this build's contract version and validates", () => {
    expect(DEFAULT_VERSION.contractVersion).toBe(
      TERMINAL_WORKSPACE_CONTRACT_VERSION,
    );
    expect(VersionSchema.parse(DEFAULT_VERSION)).toEqual(DEFAULT_VERSION);
  });

  it("the fresh snapshot seed validates against the collection's value schema", () => {
    // The daemon seeds every watched terminal with `seedSnapshot` and serves it
    // into the `snapshots` collection, whose value schema is now `TerminalSnapshotSchema`
    // (the memoryless producer's emit shape) — so the seed must stay valid against it.
    const seed = seedSnapshot("/some/repo");
    expect(TerminalSnapshotSchema.parse(seed)).toEqual(seed);
    expect(seed.pr).toEqual({ kind: "pending" });
  });

  it("declares the R6 fs/git procedures, the R9.5 byte primitives, and the watcher streams", () => {
    const spec = terminalWorkspaceSurface.spec;
    expect(Object.keys(spec.procedures?.fs ?? {})).toEqual(
      expect.arrayContaining([
        "listAll",
        "readFile",
        "statFileMtimeMs",
        // R9.5 (PR-2) additive: the range-capable preview byte read.
        "previewRead",
      ]),
    );
    expect(Object.keys(spec.procedures?.git ?? {})).toEqual(
      expect.arrayContaining(["getStatus", "getDiff"]),
    );
    // R9.5 (PR-2) additive byte primitives: paste/upload + transcript-source read.
    expect(Object.keys(spec.procedures?.scratch ?? {})).toEqual(
      expect.arrayContaining(["write"]),
    );
    expect(Object.keys(spec.procedures?.transcript ?? {})).toEqual(
      expect.arrayContaining(["read"]),
    );
    expect(Object.keys(spec.streams ?? {})).toEqual(
      expect.arrayContaining([
        "activity",
        "subscribeRepoChange",
        "subscribeFileChange",
      ]),
    );
  });

  it("bumped the contract to 3.1 — the ADDITIVE-MINOR byte primitives, skew only one direction vs 3.0", () => {
    expect(TERMINAL_WORKSPACE_CONTRACT_VERSION).toBe("3.1");
    // 3.0 → 3.1 ADDS the three host-scoped byte primitives (fs.previewRead,
    // scratch.write, transcript.read) and changes no existing primitive's shape —
    // an additive minor. So a 3.1 daemon still serves a 3.0 viewer (the new
    // procedures simply go unused), but a 3.0 daemon a 3.1 viewer dials reads as
    // `skew` (it can't serve them) — compatible in exactly one direction:
    expect(isContractVersionCompatible("3.1", "3.0")).toBe(true);
    expect(isContractVersionCompatible("3.0", "3.1")).toBe(false);
    // The 2.0 → 3.0 collection rename stays mutually incompatible, both directions.
    expect(isContractVersionCompatible("3.0", "2.0")).toBe(false);
    expect(isContractVersionCompatible("2.0", "3.0")).toBe(false);
  });

  it("the base surface carries NO `connection` cell — link health lives only at the mirror seam", () => {
    // `connection` is composed onto the surface ONLY by `mirroredSurface(...)` at
    // the nix-host re-serve seam — never on the base surface a daemon / direct
    // link serves. So the base contract stays connection-free and version-stable;
    // the cell's read-only-over-the-wire shape is asserted in surface-nix-host's
    // `connection.test.ts` (against `mirroredSurface`).
    expect(Object.keys(terminalWorkspaceSurface.spec.cells ?? {})).toEqual([
      "version",
    ]);
  });
});
