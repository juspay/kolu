import { spawn } from "node:child_process";
import { describeDaemon } from "@kolu/daemon-test-gate";
import { afterEach, describe, expect, it } from "vitest";
import {
  decayDanglingToolUse,
  decayOrphanedThinking,
  decayTrailingTransient,
  deriveState,
  hasNoDescendants,
  snapshotProcessTreeSync,
  TRANSIENT_STALE_MS,
  trailingTransient,
} from "./core.ts";

describe("trailing transient decay (#1017 phantom transient pill)", () => {
  const idle = () => true;
  const busy = () => false;

  const now = 1_700_000_000_000;

  const neverProbed = () => {
    throw new Error(
      "subtree probe must not run before the quiet window elapses",
    );
  };

  const session = (startedAt?: number) => ({
    pid: 4242,
    sessionId: "decay-session",
    cwd: "/home/user/decay-project",
    startedAt,
  });

  it("settles a dangling `tool_use` pill to `waiting` once stale and the subtree is idle", () => {
    expect(
      decayDanglingToolUse(TRANSIENT_STALE_MS + 1_000, idle, undefined, now),
    ).toEqual({ state: "waiting", recheckAt: null });
  });

  it("keeps a dangling `tool_use` and schedules a recheck before the window elapses", () => {
    expect(
      decayDanglingToolUse(
        TRANSIENT_STALE_MS - 30_000,
        neverProbed,
        undefined,
        now,
      ),
    ).toEqual({ state: "tool_use", recheckAt: now + 30_000 });
  });

  it("keeps a genuinely-working tool_use when the subtree is busy", () => {
    expect(
      decayDanglingToolUse(TRANSIENT_STALE_MS, busy, undefined, now),
    ).toEqual({ state: "tool_use", recheckAt: now + TRANSIENT_STALE_MS });
  });

  it("settles an ORPHANED `thinking` pill to `waiting` past the window WITHOUT probing the subtree", () => {
    expect(
      decayOrphanedThinking(TRANSIENT_STALE_MS + 1_000, undefined, now),
    ).toEqual({ state: "waiting", recheckAt: null });
  });

  it("keeps an orphaned `thinking` and schedules a recheck before the window elapses", () => {
    expect(
      decayOrphanedThinking(TRANSIENT_STALE_MS - 30_000, undefined, now),
    ).toEqual({ state: "thinking", recheckAt: now + 30_000 });
  });

  it("classifies a trailing `tool_use` as dangling", () => {
    expect(trailingTransient("tool_use", 2_000, session(1_000)).kind).toBe(
      "dangling_tool_use",
    );
  });

  it("classifies a `thinking` whose prompt predates this claude as orphaned", () => {
    expect(trailingTransient("thinking", 1_000, session(2_000)).kind).toBe(
      "orphaned_thinking",
    );
  });

  it("keeps a LIVE `thinking` turn (prompt not orphaned) — never probes, never decays", () => {
    const trailing = trailingTransient("thinking", 3_000, session(2_000));
    expect(trailing).toEqual({ kind: "settled", state: "thinking" });
    expect(
      decayTrailingTransient(trailing, TRANSIENT_STALE_MS * 10, undefined, now),
    ).toEqual({ state: "thinking", recheckAt: null });
  });

  it("keeps a `thinking` turn settled when the session file carries no startedAt", () => {
    expect(trailingTransient("thinking", 1_000, session()).kind).toBe(
      "settled",
    );
  });

  it.each([
    "waiting",
    "awaiting_user",
    "running_background",
  ] as const)("never decays the non-transient state `%s`", (state) => {
    expect(
      decayTrailingTransient(
        trailingTransient(state, 1_000, session(2_000)),
        TRANSIENT_STALE_MS * 10,
        undefined,
        now,
      ),
    ).toEqual({ state, recheckAt: null });
  });
});

describe("deriveState timestampMs (the entry the state derives from)", () => {
  const entry = (type: string, ts?: string, extra: object = {}) =>
    JSON.stringify({ type, ...(ts ? { timestamp: ts } : {}), ...extra });

  it("is the epoch-ms timestamp of the newest user/assistant entry", () => {
    const lines = [
      entry("assistant", "2026-06-02T11:33:48.779Z"),
      entry("user", "2026-06-02T11:35:49.791Z"),
      entry("permission-mode"),
      entry("ai-title"),
    ];
    expect(deriveState(lines)?.timestampMs).toBe(
      Date.parse("2026-06-02T11:35:49.791Z"),
    );
  });

  it("deriveState returns null when no user/assistant entry exists", () => {
    expect(deriveState([entry("permission-mode"), entry("mode")])).toBeNull();
  });

  it("is null when the newest entry lacks a parseable timestamp", () => {
    expect(deriveState([entry("user")])?.timestampMs).toBeNull();
  });
});

describe("hasNoDescendants", () => {
  it("is true when no process lists pid as its parent", () => {
    expect(
      hasNoDescendants(100, [
        { pid: 1, ppid: 0 },
        { pid: 100, ppid: 1 },
        { pid: 200, ppid: 1 },
      ]),
    ).toBe(true);
  });

  it("is false when a process is a direct child of pid", () => {
    expect(
      hasNoDescendants(100, [
        { pid: 100, ppid: 1 },
        { pid: 200, ppid: 100 },
      ]),
    ).toBe(false);
  });

  it("is true for a pid absent from the table (process already gone)", () => {
    expect(hasNoDescendants(999, [{ pid: 1, ppid: 0 }])).toBe(true);
  });
});

describeDaemon("snapshotProcessTreeSync", () => {
  const children: ReturnType<typeof spawn>[] = [];
  afterEach(() => {
    for (const c of children.splice(0)) c.kill("SIGKILL");
  });

  it("samples the live process table including this process", () => {
    const procs = snapshotProcessTreeSync();
    expect(procs).not.toBeNull();
    expect(procs?.some((p) => p.pid === process.pid)).toBe(true);
  });

  it("detects a spawned child as a descendant (the genuine-work signal)", async () => {
    const child = spawn("sleep", ["30"]);
    children.push(child);
    await new Promise((r) => setTimeout(r, 150));
    const procs = snapshotProcessTreeSync();
    expect(procs).not.toBeNull();
    expect(
      procs?.some((p) => p.pid === child.pid && p.ppid === process.pid),
    ).toBe(true);
    expect(hasNoDescendants(process.pid, procs ?? [])).toBe(false);
  });
});
