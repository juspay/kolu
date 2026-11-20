import { LOCAL_LOCATION, type SavedSession } from "@kolu/padi-client/surface";
import { Result } from "effect";
import { describe, expect, it, vi } from "vitest";

vi.mock("solid-sonner", () => ({ toast: {} }));

import { parseSavedSession } from "./sessionTransfer";

const parsed = (text: string): SavedSession => {
  const result = parseSavedSession(text);
  if (Result.isFailure(result))
    throw new Error(`expected a session, got: ${result.failure}`);
  return result.success;
};

const refusal = (text: string): string => {
  const result = parseSavedSession(text);
  if (Result.isSuccess(result)) throw new Error("expected a refusal");
  return result.failure;
};

const T1 = "11111111-1111-4111-8111-111111111111";

const valid: SavedSession = {
  terminals: [
    {
      id: T1,
      state: "active",
      cwd: "/home/user",
      git: { kind: "none" },
      pr: { kind: "absent" },
      location: LOCAL_LOCATION,
      restoreTarget: { kind: "none" },
      lastActivityAt: 0,
      promptedAt: null,
    },
  ],
  activeTerminalId: T1,
  savedAt: 1_700_000_000_000,
};

describe("parseSavedSession", () => {
  it("accepts a valid session export and round-trips it", () => {
    expect(parsed(JSON.stringify(valid))).toEqual(valid);
  });

  it("accepts an empty-terminals session", () => {
    const empty: SavedSession = {
      terminals: [],
      activeTerminalId: null,
      savedAt: 1,
    };
    expect(parsed(JSON.stringify(empty))).toEqual(empty);
  });

  it("rejects text that is not JSON", () => {
    expect(refusal("not json")).toMatch(/valid JSON/);
  });

  it("rejects JSON that is not a session export", () => {
    expect(refusal(JSON.stringify({ foo: "bar" }))).toMatch(
      /valid kolu session export/,
    );
  });

  it("rejects a session whose terminals are malformed", () => {
    const bad = { terminals: [{ id: T1 }], savedAt: 1 };
    expect(refusal(JSON.stringify(bad))).toMatch(/valid kolu session export/);
  });

  it("backfills a legacy export missing state/location/pr so the recovery hatch works", () => {
    const legacy = {
      terminals: [{ id: T1, cwd: "/home/user", git: null, lastActivityAt: 0 }],
      activeTerminalId: T1,
      savedAt: 1_700_000_000_000,
    };
    expect(parsed(JSON.stringify(legacy))).toEqual({
      ...legacy,
      terminals: [
        {
          ...legacy.terminals[0],
          git: { kind: "unresolved" },
          state: "active",
          location: LOCAL_LOCATION,
          pr: { kind: "absent" },
          promptedAt: null,
        },
      ],
    });
  });

  it("imports an export taken before the PR said draft, with that PR pending", () => {
    const before = {
      ...valid,
      terminals: [
        {
          ...valid.terminals[0],
          pr: {
            kind: "ok",
            value: {
              number: 7,
              title: "Fix the parser",
              url: "https://github.example/o/r/pull/7",
              state: "open",
              checks: "pass",
              checkRuns: [],
              reviewDecision: null,
              mergeStateStatus: "CLEAN",
              headSha: "4f21a9c0d3e5b7a9c1d3e5f7a9b1c3d5e7f9a1b3",
            },
          },
        },
      ],
    };
    expect(parsed(JSON.stringify(before))).toEqual({
      ...valid,
      terminals: [{ ...valid.terminals[0], pr: { kind: "pending" } }],
    });
  });

  it("maps a pre-cutover agentSession to an `exact` target from its STRUCTURED identity — the captured command is dropped, never parsed", () => {
    const legacy = {
      terminals: [
        {
          id: T1,
          state: "active",
          cwd: "/home/user",
          git: null,
          location: LOCAL_LOCATION,
          lastActivityAt: 5,
          lastAgentCommand: "claude --model sonnet",
          agentSession: { kind: "claude-code", id: "sess-123" },
        },
      ],
      activeTerminalId: T1,
      savedAt: 1_700_000_000_000,
    };
    expect(parsed(JSON.stringify(legacy))).toEqual({
      ...legacy,
      terminals: [
        {
          id: T1,
          state: "active",
          cwd: "/home/user",
          git: { kind: "unresolved" },
          location: LOCAL_LOCATION,
          lastActivityAt: 5,
          pr: { kind: "absent" },
          promptedAt: null,
          restoreTarget: {
            kind: "exact",
            agent: {
              kind: "claude-code",
              sessionId: "sess-123",
              resumeRef: "sess-123",
            },
            argv: [],
          },
        },
      ],
    });
  });

  it("maps a pre-cutover command WITHOUT an agentSession to `none` — a bare shell, never a re-parsed command", () => {
    const legacy = {
      terminals: [
        {
          id: T1,
          state: "active",
          cwd: "/home/user",
          git: null,
          location: LOCAL_LOCATION,
          lastActivityAt: 5,
          lastAgentCommand: "opencode --model sonnet",
        },
      ],
      activeTerminalId: T1,
      savedAt: 1_700_000_000_000,
    };
    expect(parsed(JSON.stringify(legacy))).toEqual({
      ...legacy,
      terminals: [
        {
          id: T1,
          state: "active",
          cwd: "/home/user",
          git: { kind: "unresolved" },
          location: LOCAL_LOCATION,
          lastActivityAt: 5,
          pr: { kind: "absent" },
          promptedAt: null,
          restoreTarget: { kind: "none" },
        },
      ],
    });
  });

  it("ignores a captured command that names a DIFFERENT agent than the structured identity", () => {
    const legacy = {
      terminals: [
        {
          id: T1,
          state: "active",
          cwd: "/home/user",
          git: null,
          location: LOCAL_LOCATION,
          lastActivityAt: 5,
          lastAgentCommand: "opencode --model sonnet",
          agentSession: { kind: "claude-code", id: "sess-mismatch" },
        },
      ],
      activeTerminalId: T1,
      savedAt: 1_700_000_000_000,
    };
    expect(parsed(JSON.stringify(legacy))).toEqual({
      ...legacy,
      terminals: [
        {
          id: T1,
          state: "active",
          cwd: "/home/user",
          git: { kind: "unresolved" },
          location: LOCAL_LOCATION,
          lastActivityAt: 5,
          pr: { kind: "absent" },
          promptedAt: null,
          restoreTarget: {
            kind: "exact",
            agent: {
              kind: "claude-code",
              sessionId: "sess-mismatch",
              resumeRef: "sess-mismatch",
            },
            argv: [],
          },
        },
      ],
    });
  });
});

describe("parseSavedSession refuses a file too big for one wire frame", () => {
  it("rejects before parsing, naming both sizes", () => {
    const huge = `{"pad":"${"x".repeat(5 * 1024 * 1024)}"}`;
    expect(refusal(huge)).toMatch(/the limit is/);
    expect(refusal(huge)).toMatch(/5\.0 MiB/);
  });

  it("still accepts an ordinary export", () => {
    expect(parsed(JSON.stringify(valid))).toEqual(valid);
  });
});
