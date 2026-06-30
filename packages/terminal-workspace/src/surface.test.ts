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

  it("declares the R6 fs/git procedures and watcher streams", () => {
    const spec = terminalWorkspaceSurface.spec;
    expect(Object.keys(spec.procedures?.fs ?? {})).toEqual(
      expect.arrayContaining(["listAll", "readFile", "statFileMtimeMs"]),
    );
    expect(Object.keys(spec.procedures?.git ?? {})).toEqual(
      expect.arrayContaining(["getStatus", "getDiff"]),
    );
    expect(Object.keys(spec.streams ?? {})).toEqual(
      expect.arrayContaining([
        "activity",
        "terminalEvents",
        "subscribeRepoChange",
        "subscribeFileChange",
      ]),
    );
  });

  it("declares the PR-3 terminalEvents stream — framed TerminalEvents, keyed by terminalId", () => {
    const spec = terminalWorkspaceSurface.spec;
    expect(spec.streams?.terminalEvents).toBeDefined();
  });

  it("bumped the contract to 3.1 — the ADDITIVE terminalEvents stream, still compatible with a 3.0 viewer", () => {
    expect(TERMINAL_WORKSPACE_CONTRACT_VERSION).toBe("3.1");
    // 3.0 → 3.1 ADDS the `terminalEvents` stream. A new stream is ADDITIVE — a 3.0
    // viewer simply never subscribes to it — so a 3.1 daemon still serves a 3.0 viewer
    // (a one-directional minor bump, NOT the mutual skew a breaking major forces).
    expect(isContractVersionCompatible("3.1", "3.0")).toBe(true);
    // The 2.0 → 3.0 collection RENAME stays a breaking major in BOTH directions.
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
