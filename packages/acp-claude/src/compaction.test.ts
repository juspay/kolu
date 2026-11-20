import { describe, expect, test } from "vitest";

import {
  CLAUDE,
  compactingAt,
  compactsPast,
  OPEN_SESSION_META,
} from "./leg.ts";

describe("a leg that compacts at a number of kolu's choosing", () => {
  test("opens every session with the launcher's settings and its own, beside the raw-message subscription", () => {
    const leg = compactingAt(200_000, { attribution: { commit: "", pr: "" } });
    expect(leg.compaction).toBe(true);
    expect(leg.rawMessages?.openMeta).toEqual({
      claudeCode: {
        emitRawSDKMessages: [{ type: "system", subtype: "init" }],
        options: {
          settings: {
            attribution: { commit: "", pr: "" },
            autoCompactEnabled: true,
            autoCompactWindow: 233_000,
          },
        },
      },
    });
  });

  test("keeps its own compaction settings over any the launcher passed", () => {
    const leg = compactingAt(200_000, {
      autoCompactEnabled: false,
      autoCompactWindow: 1,
    });
    expect(leg.rawMessages?.openMeta).toMatchObject({
      claudeCode: {
        options: {
          settings: { autoCompactEnabled: true, autoCompactWindow: 233_000 },
        },
      },
    });
    expect(leg.rawMessages?.method).toBe(CLAUDE.rawMessages?.method);
    expect(leg.rawMessages?.modelIn).toBe(CLAUDE.rawMessages?.modelIn);
    expect(leg.rawMessages?.serversIn).toBe(CLAUDE.rawMessages?.serversIn);
  });

  test("leaves the shared leg as it was", () => {
    compactingAt(200_000, {});
    expect(CLAUDE.compaction).toBeUndefined();
    expect(CLAUDE.rawMessages?.openMeta).toBe(OPEN_SESSION_META);
    expect(OPEN_SESSION_META).toEqual({
      claudeCode: { emitRawSDKMessages: [{ type: "system", subtype: "init" }] },
    });
  });

  test("knows it fires at the number on a large model", () => {
    const compacts = compactsPast(200_000);
    expect(compacts({ used: 199_999, size: 1_000_000 })).toBe(false);
    expect(compacts({ used: 200_000, size: 1_000_000 })).toBe(true);
  });

  test("... and sooner on a model whose own window is smaller", () => {
    const compacts = compactsPast(200_000);
    expect(compacts({ used: 166_999, size: 200_000 })).toBe(false);
    expect(compacts({ used: 167_000, size: 200_000 })).toBe(true);
  });
});
