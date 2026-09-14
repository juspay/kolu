/** Byte-level fixtures for anyagent's PERSISTED vocabulary.
 *
 *  `RestoreTargetSchema` (and the `AgentIdentitySchema` nested inside its
 *  `exact` arm) rides to DISK on padi's authored terminal record — a slept or
 *  cold-restored terminal resumes THAT conversation by reading these exact
 *  bytes back (juspay/kolu#1495). `TaskProgressSchema` rides the wire inside
 *  every agent integration's info payload.
 *
 *  So the assertions below pin the ENCODED JSON STRING, not merely
 *  decode-equality: a key rename, a key REORDER, a newly-emitted key, or a
 *  dropped one would all survive a round-trip check while breaking every
 *  record already on a user's disk. The fixture strings are the bytes the
 *  pre-Effect (zod) schemas produced, transcribed verbatim.
 *
 *  The decode direction pins the READER's tolerance policy: an on-disk record
 *  written by a NEWER kolu carrying a field this build doesn't know is read by
 *  dropping the unknown field, never by rejecting the whole record — the
 *  rolling-deploy / downgrade path. That is policy, not a fallback. */

import { Result, Schema } from "effect";
import { describe, expect, it } from "vitest";
import {
  AgentIdentitySchema,
  type RestoreTarget,
  RestoreTargetSchema,
  TaskProgressSchema,
} from "./schemas.ts";

const encodeIdentity = Schema.encodeSync(AgentIdentitySchema);
const decodeIdentity = Schema.decodeUnknownSync(AgentIdentitySchema);
const encodeTarget = Schema.encodeSync(RestoreTargetSchema);
const decodeTarget = Schema.decodeUnknownSync(RestoreTargetSchema);
const decodeTargetResult = Schema.decodeUnknownResult(RestoreTargetSchema);
const decodeIdentityResult = Schema.decodeUnknownResult(AgentIdentitySchema);
const encodeProgress = Schema.encodeSync(TaskProgressSchema);
const decodeProgressResult = Schema.decodeUnknownResult(TaskProgressSchema);

/** A real claude-code session id shape (the UUID `resumeAgentCommand` gates on). */
const SESSION_ID = "0192f3a1-4c5b-7d8e-9f01-23456789abcd";

describe("AgentIdentitySchema — the persisted resume identity, byte for byte", () => {
  it("encodes to the exact on-disk JSON", () => {
    expect(
      JSON.stringify(
        encodeIdentity({
          kind: "claude-code",
          sessionId: SESSION_ID,
          resumeRef: SESSION_ID,
        }),
      ),
    ).toBe(
      `{"kind":"claude-code","sessionId":"${SESSION_ID}","resumeRef":"${SESSION_ID}"}`,
    );
  });

  it("decodes a record already on disk", () => {
    expect(
      decodeIdentity({
        kind: "opencode",
        sessionId: "ses_abc123XYZ",
        resumeRef: "ses_abc123XYZ",
      }),
    ).toStrictEqual({
      kind: "opencode",
      sessionId: "ses_abc123XYZ",
      resumeRef: "ses_abc123XYZ",
    });
  });

  it("accepts an OPEN kind — anyagent names no agent, so a record for an agent this build does not know still decodes", () => {
    // The kind is a plain string here by design: the refusal for an unknown
    // agent happens at the point of use (`resumeAgentCommand`'s registry gate),
    // not at the decode boundary — a decode throw would drop the whole terminal.
    expect(
      decodeIdentity({
        kind: "a-new-agent",
        sessionId: "x",
        resumeRef: "x",
      }).kind,
    ).toBe("a-new-agent");
  });

  it("refuses a record missing `resumeRef` — the migration (not a default) supplies it", () => {
    expect(
      Result.isFailure(
        decodeIdentityResult({ kind: "claude-code", sessionId: SESSION_ID }),
      ),
    ).toBe(true);
  });
});

describe("RestoreTargetSchema — every arm, byte for byte", () => {
  /** `none` is the wake-lands-on-a-bare-shell arm (juspay/kolu#1492): one key,
   *  no smuggled second meaning. */
  it("encodes `none` as a bare discriminant", () => {
    expect(JSON.stringify(encodeTarget({ kind: "none" }))).toBe(
      `{"kind":"none"}`,
    );
  });

  it("encodes `exact` with the identity nested under `agent`", () => {
    const target: RestoreTarget = {
      kind: "exact",
      command: "claude --model sonnet",
      agent: {
        kind: "claude-code",
        sessionId: SESSION_ID,
        resumeRef: SESSION_ID,
      },
    };
    expect(JSON.stringify(encodeTarget(target))).toBe(
      `{"kind":"exact","command":"claude --model sonnet","agent":{"kind":"claude-code","sessionId":"${SESSION_ID}","resumeRef":"${SESSION_ID}"}}`,
    );
  });

  it("encodes `legacyMostRecent` with a command and no identity", () => {
    expect(
      JSON.stringify(
        encodeTarget({ kind: "legacyMostRecent", command: "codex --yolo" }),
      ),
    ).toBe(`{"kind":"legacyMostRecent","command":"codex --yolo"}`);
  });

  it("round-trips each arm's on-disk bytes unchanged", () => {
    for (const bytes of [
      `{"kind":"none"}`,
      `{"kind":"exact","command":"claude --model sonnet","agent":{"kind":"claude-code","sessionId":"${SESSION_ID}","resumeRef":"${SESSION_ID}"}}`,
      `{"kind":"legacyMostRecent","command":"codex --yolo"}`,
    ]) {
      expect(
        JSON.stringify(encodeTarget(decodeTarget(JSON.parse(bytes)))),
      ).toBe(bytes);
    }
  });
});

describe("RestoreTargetSchema — reader tolerance and refusal", () => {
  /** Rolling deploy / downgrade: a record written by a NEWER kolu carries a
   *  field this build has never heard of. Reading it drops the unknown field
   *  rather than failing the whole record, so a user who rolls back does not
   *  lose their resume target. */
  it("drops fields a newer writer added, at both nesting levels", () => {
    expect(
      decodeTarget({
        kind: "exact",
        command: "claude --model sonnet",
        agent: {
          kind: "claude-code",
          sessionId: SESSION_ID,
          resumeRef: SESSION_ID,
          workspace: "/tmp/x",
        },
        capturedAt: 1767225600000,
      }),
    ).toStrictEqual({
      kind: "exact",
      command: "claude --model sonnet",
      agent: {
        kind: "claude-code",
        sessionId: SESSION_ID,
        resumeRef: SESSION_ID,
      },
    });
  });

  /** Refusal is what makes `restoreTargetOf`'s three arms exhaustive: a
   *  half-written `exact` (id captured, command lost, or the reverse) must not
   *  decode into something the wake path would act on. padi drops the whole
   *  malformed record instead. */
  it("refuses an `exact` arm missing its command or its identity", () => {
    expect(
      Result.isFailure(
        decodeTargetResult({
          kind: "exact",
          agent: {
            kind: "claude-code",
            sessionId: SESSION_ID,
            resumeRef: SESSION_ID,
          },
        }),
      ),
    ).toBe(true);
    expect(
      Result.isFailure(
        decodeTargetResult({ kind: "exact", command: "claude --model sonnet" }),
      ),
    ).toBe(true);
  });

  it("refuses an unknown discriminant rather than guessing an arm", () => {
    expect(Result.isFailure(decodeTargetResult({ kind: "mostRecent" }))).toBe(
      true,
    );
    expect(Result.isFailure(decodeTargetResult({}))).toBe(true);
  });
});

describe("TaskProgressSchema — the cross-integration wire payload", () => {
  it("encodes to the exact wire JSON, total before completed", () => {
    expect(JSON.stringify(encodeProgress({ total: 7, completed: 3 }))).toBe(
      `{"total":7,"completed":3}`,
    );
    expect(JSON.stringify(encodeProgress({ total: 0, completed: 0 }))).toBe(
      `{"total":0,"completed":0}`,
    );
  });

  it("refuses a missing or non-numeric count", () => {
    expect(Result.isFailure(decodeProgressResult({ total: 7 }))).toBe(true);
    expect(
      Result.isFailure(decodeProgressResult({ total: "7", completed: 3 })),
    ).toBe(true);
  });
});
