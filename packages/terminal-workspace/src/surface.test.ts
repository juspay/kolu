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
});
