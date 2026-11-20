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
  it("encodes `none` as a bare discriminant", () => {
    expect(JSON.stringify(encodeTarget({ kind: "none" }))).toBe(
      `{"kind":"none"}`,
    );
  });

  it("encodes `exact` as identity + allowlisted argv — and NO command string", () => {
    const target: RestoreTarget = {
      kind: "exact",
      agent: {
        kind: "claude-code",
        sessionId: SESSION_ID,
        resumeRef: SESSION_ID,
      },
      argv: ["--model", "sonnet", "--dangerously-skip-permissions"],
    };
    const bytes = JSON.stringify(encodeTarget(target));
    expect(bytes).toBe(
      `{"kind":"exact","agent":{"kind":"claude-code","sessionId":"${SESSION_ID}","resumeRef":"${SESSION_ID}"},"argv":["--model","sonnet","--dangerously-skip-permissions"]}`,
    );
    expect(bytes).not.toContain("command");
  });

  it("round-trips each arm's on-disk bytes unchanged", () => {
    for (const bytes of [
      `{"kind":"none"}`,
      `{"kind":"exact","agent":{"kind":"claude-code","sessionId":"${SESSION_ID}","resumeRef":"${SESSION_ID}"},"argv":[]}`,
      `{"kind":"exact","agent":{"kind":"pi","sessionId":"s1","resumeRef":"/tmp/a.jsonl"},"argv":["--model","x"]}`,
    ]) {
      expect(
        JSON.stringify(encodeTarget(decodeTarget(JSON.parse(bytes)))),
      ).toBe(bytes);
    }
  });
});

describe("RestoreTargetSchema — reader tolerance and refusal", () => {
  it("drops fields a newer writer added, at both nesting levels", () => {
    expect(
      decodeTarget({
        kind: "exact",
        argv: ["--model", "sonnet"],
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
      argv: ["--model", "sonnet"],
      agent: {
        kind: "claude-code",
        sessionId: SESSION_ID,
        resumeRef: SESSION_ID,
      },
    });
  });

  it("refuses an `exact` arm missing its identity or its argv", () => {
    expect(
      Result.isFailure(
        decodeTargetResult({
          kind: "exact",
          argv: [],
        }),
      ),
    ).toBe(true);
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
  });

  it("refuses the old `command`-bearing exact arm and `legacyMostRecent`", () => {
    expect(
      Result.isFailure(
        decodeTargetResult({
          kind: "exact",
          command: "claude --model sonnet",
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
        decodeTargetResult({
          kind: "legacyMostRecent",
          command: "codex --yolo",
        }),
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
