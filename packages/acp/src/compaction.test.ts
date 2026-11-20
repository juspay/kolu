import { describe, expect, test } from "vitest";

import { compactionIn } from "./compaction.ts";

describe("a compaction report", () => {
  test("the opening frame says it is running", () => {
    expect(
      compactionIn({
        sessionUpdate: "compaction_update",
        compactionId: "c1",
        status: "in_progress",
        _meta: { contextCompaction: { version: 1 } },
      }),
    ).toEqual({
      kind: "update",
      id: "c1",
      status: "in_progress",
      summary: null,
      error: null,
    });
  });

  test("the terminal frame carries the summary as text", () => {
    expect(
      compactionIn({
        sessionUpdate: "compaction_update",
        compactionId: "c1",
        status: "completed",
        summary: [
          { type: "text", text: "Two works are open. " },
          { type: "image", data: "", mimeType: "image/png" },
          { type: "text", text: "The human is away until five." },
        ],
      }),
    ).toEqual({
      kind: "update",
      id: "c1",
      status: "completed",
      summary: "Two works are open. The human is away until five.",
      error: null,
    });
  });

  test("a status-only duplicate leaves the summary alone, and a clear empties it", () => {
    const duplicate = compactionIn({
      sessionUpdate: "compaction_update",
      compactionId: "c1",
      status: "completed",
      _meta: { contextCompaction: { trigger: "automatic", preTokens: 201012 } },
    });
    expect(duplicate?.kind === "update" && duplicate.summary).toBeNull();
    const cleared = compactionIn({
      sessionUpdate: "compaction_update",
      compactionId: "c1",
      status: "completed",
      summary: null,
    });
    expect(cleared?.kind === "update" && cleared.summary).toBe("");
  });

  test("a failure carries its reason, and a cancelled one is its own status", () => {
    expect(
      compactionIn({
        sessionUpdate: "compaction_update",
        compactionId: "c2",
        status: "failed",
        error: "the summary request was refused (overloaded)",
      }),
    ).toEqual({
      kind: "update",
      id: "c2",
      status: "failed",
      summary: null,
      error: "the summary request was refused (overloaded)",
    });
    expect(
      compactionIn({
        sessionUpdate: "compaction_update",
        compactionId: "c3",
        status: "cancelled",
      }),
    ).toMatchObject({ status: "cancelled", error: null });
  });

  test("a chunk appends text to the summary of its compaction", () => {
    expect(
      compactionIn({
        sessionUpdate: "compaction_summary_chunk",
        compactionId: "c1",
        content: { type: "text", text: "Two works are open." },
      }),
    ).toEqual({ kind: "chunk", id: "c1", text: "Two works are open." });
  });

  test("anything else is not a report", () => {
    expect(
      compactionIn({
        sessionUpdate: "compaction_update",
        compactionId: "c1",
        status: "paused",
      }),
    ).toBeNull();
    expect(
      compactionIn({ sessionUpdate: "compaction_update", status: "completed" }),
    ).toBeNull();
    expect(
      compactionIn({
        sessionUpdate: "compaction_summary_chunk",
        compactionId: "c1",
        content: { type: "image", data: "", mimeType: "image/png" },
      }),
    ).toBeNull();
    expect(
      compactionIn({ sessionUpdate: "usage_update", used: 1, size: 2 }),
    ).toBeNull();
    expect(
      compactionIn({
        sessionUpdate: "compaction_update",
        compactionId: "toString",
        status: "toString",
      }),
    ).toBeNull();
    expect(compactionIn(null)).toBeNull();
    expect(compactionIn("compaction_update")).toBeNull();
  });
});
