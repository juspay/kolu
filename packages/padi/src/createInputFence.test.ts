import { PadiCreateInputSchema } from "@kolu/padi-client/surface";
import { Schema } from "effect";
import { describe, expect, it } from "vitest";
import type { createTerminal, restoreSpawn } from "./terminals.ts";

describe("create-input fence — restore-only facts never ride an ordinary create", () => {
  it("the wire schema carries none of the three restore-only facts (by construction, not omission)", () => {
    const parsed = Schema.decodeUnknownSync(PadiCreateInputSchema)({
      placement: { kind: "toplevel" },
      cwd: "/x",
      themeName: "dracula",
      lastActivityAt: 5,
      promptedAt: 4,
      restoreTarget: { kind: "none" },
    });
    expect("lastActivityAt" in parsed).toBe(false);
    expect("promptedAt" in parsed).toBe(false);
    expect("restoreTarget" in parsed).toBe(false);
    expect(parsed.cwd).toBe("/x");
    expect(parsed.themeName).toBe("dracula");
  });

  it("compile-time: createTerminal's metadata forbids a restore-only field; restoreSpawn's accepts it", () => {
    type CreateMetadata = NonNullable<Parameters<typeof createTerminal>[2]>;
    type RestoreMetadata = Parameters<typeof restoreSpawn>[4];
    const createForbids: "restoreTarget" extends keyof CreateMetadata
      ? false
      : true = true;
    const restoreAccepts: "restoreTarget" extends keyof RestoreMetadata
      ? true
      : false = true;
    expect([createForbids, restoreAccepts]).toEqual([true, true]);
  });
});
