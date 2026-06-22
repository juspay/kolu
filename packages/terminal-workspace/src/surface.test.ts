import { isContractVersionCompatible } from "@kolu/surface/define";
import { describe, expect, it } from "vitest";
import { seedAwarenessValue } from "./index.ts";
import { AwarenessValueSchema } from "./schema.ts";
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

  it("bumped the contract to 1.0 — a BREAKING getStatus reshape, skew in BOTH directions vs 0.3", () => {
    expect(TERMINAL_WORKSPACE_CONTRACT_VERSION).toBe("1.0");
    // The 1.0 getStatus `local` arm dropped the always-null `base` (and grew the
    // branch/working-tree fields). A 0.3 viewer's schema requires `base` in every
    // mode, so a 1.0 daemon's `local` result fails its parse — NOT additive. The
    // gate must therefore mark the two mutually incompatible, both directions:
    // a 1.0 daemon can't serve a 0.3 viewer that still expects `base`…
    expect(isContractVersionCompatible("1.0", "0.3")).toBe(false);
    // …and a 0.3 daemon can't serve a 1.0 viewer that expects branch/ahead-behind.
    expect(isContractVersionCompatible("0.3", "1.0")).toBe(false);
    // A newer-minor 1.x daemon (a future additive bump) still serves a 1.0 viewer.
    expect(isContractVersionCompatible("1.1", "1.0")).toBe(true);
  });
});
