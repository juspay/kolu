import { isContractVersionCompatible } from "@kolu/surface/define";
import { describe, expect, it } from "vitest";
import { seedAwarenessValue } from "./index.ts";
import { AwarenessValueSchema } from "./schema.ts";
import {
  DEFAULT_CONNECTION,
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

  it("the fresh awareness seed validates against the collection's value schema", () => {
    // The daemon seeds every watched terminal with `seedAwarenessValue` and
    // serves it into the `awareness` collection, whose value schema is
    // `AwarenessValueSchema` — so the seed must stay valid against it.
    const seed = seedAwarenessValue("/some/repo");
    expect(AwarenessValueSchema.parse(seed)).toEqual(seed);
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
        "subscribeRepoChange",
        "subscribeFileChange",
      ]),
    );
  });

  it("is at 1.1 — additive `connection` cell over 1.0, still skew in BOTH directions vs 0.3", () => {
    expect(TERMINAL_WORKSPACE_CONTRACT_VERSION).toBe("1.1");
    // 0.3 → 1.0 was BREAKING: the getStatus `local` arm dropped the always-null
    // `base` (and grew branch/working-tree fields), so a 0.3 viewer's schema
    // (which requires `base` in every mode) fails to parse a 1.0 daemon's
    // `local` result. The gate marks 1.x and 0.3 mutually incompatible, both
    // directions — the major boundary still holds at 1.1:
    expect(isContractVersionCompatible("1.1", "0.3")).toBe(false);
    expect(isContractVersionCompatible("0.3", "1.1")).toBe(false);
    // 1.0 → 1.1 is ADDITIVE (a new `connection` cell): a 1.1 daemon still serves
    // a 1.0 viewer (extra cell ignored)…
    expect(isContractVersionCompatible("1.1", "1.0")).toBe(true);
    // …but a 1.0 daemon does NOT satisfy a 1.1 viewer that may read the new cell
    // (higher-minor consumer doesn't trust a lower-minor peer) — the standard
    // additive-handshake direction.
    expect(isContractVersionCompatible("1.0", "1.1")).toBe(false);
  });

  it("composes the gate-closed `connection` cell onto the surface", () => {
    // The cell rides the surface so the daemon stubs it and a re-serving parent
    // writes it live; its default is `connecting` (gate-closed) so "healthy-empty
    // before the first frame" is unrepresentable.
    expect(Object.keys(terminalWorkspaceSurface.spec.cells ?? {})).toEqual(
      expect.arrayContaining(["version", "connection"]),
    );
    expect(DEFAULT_CONNECTION.state).toBe("connecting");
  });
});
