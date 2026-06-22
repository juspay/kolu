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

  it("bumped the contract to 0.4 — additive, so it gates an OLDER daemon as skew", () => {
    expect(TERMINAL_WORKSPACE_CONTRACT_VERSION).toBe("0.4");
    // A 0.4 daemon serves a 0.3 viewer (the getStatus branch/working-tree
    // additions are backward-compatible — older viewers ignore them)…
    expect(isContractVersionCompatible("0.4", "0.3")).toBe(true);
    // …but a 0.3 daemon can't serve a 0.4 consumer's branch/ahead-behind needs —
    // the dial gates it as skew and re-provisions.
    expect(isContractVersionCompatible("0.3", "0.4")).toBe(false);
  });
});
