import { spawn } from "node:child_process";
import { afterEach, describe, expect, it } from "vitest";
import {
  decayTransientState,
  hasNoDescendants,
  snapshotProcessTree,
  TRANSIENT_STALE_MS,
} from "./core.ts";

// --- The phantom transient pill (#1017) ---
//
// A trailing transient transcript state — `thinking` (newest entry is a `user`
// line) or a dangling `tool_use` (an assistant tool call with no following
// tool_result) — keeps `deriveState` reporting a *working* state with no decay.
// Correct transiently; wrong once the session is abandoned (most reliably:
// claude killed mid-tool, then resumed idle by session-restore). The dock spins
// forever. `deriveState` can't tell a genuine in-flight turn from an abandoned
// one from a single transcript snapshot, so de-escalation needs two
// out-of-band signals: the transcript has gone quiet past a window AND claude's
// process subtree is idle (no descendant process — a genuine tool keeps a
// child). `decayTransientState` is the pure policy that composes them.

describe("decayTransientState (#1017 phantom transient pill)", () => {
  const idle = () => true;
  const busy = () => false;
  /** A probe that fails the test if invoked — asserts the window gate runs
   *  before the (real, process-spawning) subtree probe so the common path
   *  never pays for it. */
  const neverProbed = () => {
    throw new Error(
      "subtree probe must not run before the quiet window elapses",
    );
  };

  it("settles an abandoned `thinking` pill to `waiting` once stale and the subtree is idle", () => {
    // THE BUG: a trailing `user` entry keeps deriveState at `thinking` forever.
    // Past the quiet window with an idle claude subtree it must decay.
    expect(decayTransientState("thinking", TRANSIENT_STALE_MS, idle)).toEqual({
      state: "waiting",
      recheckInMs: null,
    });
  });

  it("settles a dangling `tool_use` pill to `waiting` once stale and the subtree is idle", () => {
    // The reproduced case: claude killed mid-Bash, resumed idle — a dangling
    // tool_use with no tool_result and no live child process.
    expect(
      decayTransientState("tool_use", TRANSIENT_STALE_MS + 1_000, idle),
    ).toEqual({ state: "waiting", recheckInMs: null });
  });

  it("keeps the transient and schedules a recheck before the window elapses", () => {
    // Not yet stale: never probe the subtree, but arm a one-shot recheck at the
    // moment the window *would* elapse (a quiet transcript fires no fs event).
    expect(
      decayTransientState("thinking", TRANSIENT_STALE_MS - 30_000, neverProbed),
    ).toEqual({ state: "thinking", recheckInMs: 30_000 });
  });

  it("keeps a genuinely-working transient when the subtree is busy", () => {
    // Stale transcript but claude still has a descendant (a long Bash / a
    // sub-agent) → real work; never cleared. Re-probe after another window.
    expect(decayTransientState("tool_use", TRANSIENT_STALE_MS, busy)).toEqual({
      state: "tool_use",
      recheckInMs: TRANSIENT_STALE_MS,
    });
  });

  it.each([
    "waiting",
    "awaiting_user",
    "running_background",
  ] as const)("never decays the non-transient state `%s`", (state) => {
    // running_background has its own decay path (#1109); waiting/awaiting_user
    // are settled / a genuine human gate. None should ever probe the subtree.
    expect(
      decayTransientState(state, TRANSIENT_STALE_MS * 10, neverProbed),
    ).toEqual({ state, recheckInMs: null });
  });
});

// --- Process-subtree discriminator ---
//
// The signal that separates a genuine in-flight turn from an abandoned one: a
// working claude keeps a descendant process (the Bash child it spawned, or a
// sub-agent claude); an abandoned / killed-then-resumed-idle claude has none.

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

describe("snapshotProcessTree", () => {
  const children: ReturnType<typeof spawn>[] = [];
  afterEach(() => {
    for (const c of children.splice(0)) c.kill("SIGKILL");
  });

  it("samples the live process table including this process", () => {
    const procs = snapshotProcessTree();
    expect(procs).not.toBeNull();
    expect(procs?.some((p) => p.pid === process.pid)).toBe(true);
  });

  it("detects a spawned child as a descendant (the genuine-work signal)", async () => {
    const child = spawn("sleep", ["30"]);
    children.push(child);
    await new Promise((r) => setTimeout(r, 150));
    const procs = snapshotProcessTree();
    expect(procs).not.toBeNull();
    expect(
      procs?.some((p) => p.pid === child.pid && p.ppid === process.pid),
    ).toBe(true);
    expect(hasNoDescendants(process.pid, procs ?? [])).toBe(false);
  });
});
