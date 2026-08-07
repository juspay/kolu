import { Result, Schema } from "effect";
import { describe, expect, it } from "vitest";
import { WorkflowJournalSchema } from "./core.ts";

/** The workflow run journal (`<session>/workflows/<runId>.json`) is a FOREIGN,
 *  read-only format: Claude Code writes it, kolu only reads it. Two properties
 *  are contractual and pinned here.
 *
 *  1. TOLERANCE — a journal missing `status` and/or `agentCount` still decodes,
 *     landing on "running" / 0. That is policy for journals written by Claude
 *     Code builds that predate those fields, not a fallback: without it the
 *     whole journal is skipped and the fan-out badge goes blank. The defaults
 *     fill a MISSING key only; a present-but-wrong-typed value still fails the
 *     parse, so a genuine format change surfaces as a skipped journal rather
 *     than a silently-wrong snapshot.
 *  2. BYTES — the encoded shape uses the journal's own field names
 *     (`workflowName`/`agentCount`), not the domain names, so the mapping can
 *     never invert unnoticed. kolu never writes these files; the encode
 *     direction is pinned purely as the contract's other half. */
describe("WorkflowJournalSchema (foreign on-disk format)", () => {
  const decode = Schema.decodeUnknownResult(WorkflowJournalSchema);

  it("decodes a real-shaped completion snapshot", () => {
    const raw = JSON.parse(
      '{"workflowName":"deep-research","status":"completed","agentCount":12,"runId":"wf_01k9","startedAt":"2026-08-01T12:00:00.000Z"}',
    );
    const parsed = decode(raw);
    expect(Result.isSuccess(parsed) && parsed.success).toEqual({
      name: "deep-research",
      status: "completed",
      agents: 12,
    });
  });

  it("defaults a missing status to running and a missing agentCount to 0", () => {
    const parsed = decode(JSON.parse('{"workflowName":"deep-research"}'));
    expect(Result.isSuccess(parsed) && parsed.success).toEqual({
      name: "deep-research",
      status: "running",
      agents: 0,
    });
  });

  it("defaults each field independently", () => {
    const noStatus = decode({ workflowName: "a", agentCount: 4 });
    expect(Result.isSuccess(noStatus) && noStatus.success).toEqual({
      name: "a",
      status: "running",
      agents: 4,
    });
    const noCount = decode({ workflowName: "a", status: "failed" });
    expect(Result.isSuccess(noCount) && noCount.success).toEqual({
      name: "a",
      status: "failed",
      agents: 0,
    });
  });

  it("skips (does not default) a journal whose fields are wrong-typed or absent", () => {
    expect(Result.isFailure(decode({ status: "running" }))).toBe(true);
    expect(Result.isFailure(decode({ workflowName: "a", status: null }))).toBe(
      true,
    );
    expect(
      Result.isFailure(decode({ workflowName: "a", agentCount: "12" })),
    ).toBe(true);
    expect(Result.isFailure(decode("not an object"))).toBe(true);
  });

  it("encodes back to the journal's own field names, byte-for-byte", () => {
    expect(
      JSON.stringify(
        Schema.encodeSync(WorkflowJournalSchema)({
          name: "deep-research",
          status: "completed",
          agents: 12,
        }),
      ),
    ).toBe(
      '{"workflowName":"deep-research","status":"completed","agentCount":12}',
    );
  });
});
