/**
 * Publish-routing + type-fence tests for the Design-S awareness/metadata seam.
 *
 * Guards against the firehose regressing: persisted-awareness writers MUST fire
 * `terminals:dirty`; live-awareness writers MUST NOT. The type fences pin the
 * structural guarantee that awareness has ONE writer:
 *   - `updateServerMetadata`'s mutator can't touch a LIVE field;
 *   - `updateServerLiveMetadata`'s mutator can't touch a PERSISTED field;
 *   - `entry.meta` (now AUTHORED) names NO awareness field — `entry.meta.cwd = x`
 *     is a compile error.
 */

import { type AwarenessValue, LOCAL_LOCATION } from "kolu-common/surface";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { terminalsDirtyChannel } from "../publisher.ts";
import {
  type ActiveTerminalProcess,
  getTerminal,
  registerTerminal,
  unregisterTerminal,
} from "../terminal-registry.ts";
import {
  __resetSurfaceCtxForTest,
  noopSurfaceCtxForTest,
  setSurfaceCtx,
} from "../surfaceCtx.ts";
import {
  __resetWorkspaceSurfaceCtxForTest,
  noopWorkspaceSurfaceCtxForTest,
  setWorkspaceSurfaceCtx,
} from "../workspaceSurfaceCtx.ts";
import {
  applyMirroredAwareness,
  installAwareness,
  updateClientMetadata,
  updateServerLiveMetadata,
  updateServerMetadata,
} from "./metadata.ts";

const ID = "term-pub-test";

/** A registry entry — AUTHORED half (`meta`, no awareness field) + the AWARENESS
 *  half (`awareness`, the sink's mutate target), both on the one entry. */
function fakeTerminal(): ActiveTerminalProcess {
  return {
    info: { id: ID, pid: 0 },
    meta: { state: "active", location: LOCAL_LOCATION },
    awareness: awValue(),
    // Tests never touch the PTY handle; the publish path doesn't read it.
    handle: {} as ActiveTerminalProcess["handle"],
  };
}

/** The AWARENESS half — rides the entry under the same id. */
function awValue(): AwarenessValue {
  return {
    cwd: "/tmp",
    git: null,
    lastActivityAt: 0,
    pr: { kind: "pending" },
    agent: null,
    foreground: null,
  };
}

let dirtyCount: number;
let stopWatch: () => void;

/** Yield to the event loop so the channel's async iterator can receive queued
 *  publishes. The publisher pipeline is async end-to-end, so a synchronous read
 *  immediately after a mutator would see the pre-event count. Two `setImmediate`
 *  ticks cover both legs of the pipe. */
async function settle(): Promise<void> {
  await new Promise<void>((resolve) => setImmediate(resolve));
  await new Promise<void>((resolve) => setImmediate(resolve));
}

beforeEach(async () => {
  // surface.ts is not imported here; supply no-op ctxes so the publish paths
  // (the `kolu` authored collection + the `terminalWorkspace` awareness
  // collection) don't throw.
  setSurfaceCtx(noopSurfaceCtxForTest());
  setWorkspaceSurfaceCtx(noopWorkspaceSurfaceCtxForTest());
  // Design-S: the server mutators key on id and land on `entry.awareness`; the
  // wire publish reads the registry. Register the entry (carrying BOTH halves),
  // then fan its awareness out.
  const entry = fakeTerminal();
  registerTerminal(ID, entry);
  installAwareness(ID, entry.awareness);
  dirtyCount = 0;
  stopWatch = terminalsDirtyChannel.consume({
    onEvent: () => {
      dirtyCount += 1;
    },
    onError: () => {},
  });
  // Let `consume`'s async IIFE reach its first `for await` before any publish.
  await settle();
});

afterEach(() => {
  stopWatch?.();
  // Dropping the entry drops its awareness too (one backing store now).
  unregisterTerminal(ID);
  __resetSurfaceCtxForTest();
  __resetWorkspaceSurfaceCtxForTest();
});

describe("metadata publish routing", () => {
  it("updateServerMetadata fires terminals:dirty (cwd is persisted)", async () => {
    updateServerMetadata(ID, (m) => {
      m.cwd = "/new/cwd";
    });
    await settle();
    expect(dirtyCount).toBe(1);
  });

  it("updateClientMetadata fires terminals:dirty (every client field is persisted)", async () => {
    const entry = getTerminal(ID) as ActiveTerminalProcess;
    updateClientMetadata(entry, ID, (m) => {
      m.themeName = "dracula";
    });
    await settle();
    expect(dirtyCount).toBe(1);
  });

  it("updateServerLiveMetadata does NOT fire terminals:dirty (agent stream is live)", async () => {
    updateServerLiveMetadata(ID, (m) => {
      m.agent = {
        kind: "claude-code",
        state: "thinking",
        sessionId: "sess-A",
        model: null,
        summary: "tick",
        taskProgress: null,
        workflow: null,
        contextTokens: null,
        startedAt: null,
      };
    });
    await settle();
    expect(dirtyCount).toBe(0);
  });

  it("updateServerLiveMetadata called repeatedly stays silent (the firehose case)", async () => {
    for (let i = 0; i < 50; i += 1) {
      updateServerLiveMetadata(ID, (m) => {
        m.foreground = { name: "claude", title: `tick ${i}` };
      });
    }
    await settle();
    expect(dirtyCount).toBe(0);
  });

  // Type-fence assertions — the structural guarantee that the firehose can't grow
  // back AND that awareness has one writer. If any `@ts-expect-error` line starts
  // compiling, a fence is broken. Test runtime is irrelevant; the assertion is at
  // type check.
  it("type fence: live fields cannot be written through updateServerMetadata", () => {
    updateServerMetadata(ID, (m) => {
      // @ts-expect-error — `agent` is live, not persisted.
      m.agent = null;
      // @ts-expect-error — `pr` is live, not persisted.
      m.pr = { kind: "pending" };
      // @ts-expect-error — `foreground` is live, not persisted.
      m.foreground = null;
    });
  });

  it("type fence: persisted fields cannot be written through updateServerLiveMetadata", () => {
    updateServerLiveMetadata(ID, (m) => {
      // @ts-expect-error — `cwd` is persisted, not live.
      m.cwd = "/tmp";
      // @ts-expect-error — `lastActivityAt` is persisted, not live.
      m.lastActivityAt = 0;
    });
  });

  it("type fence: awareness fields cannot be written through entry.meta (authored)", () => {
    const entry = getTerminal(ID) as ActiveTerminalProcess;
    // @ts-expect-error — `cwd` lives in the awareness store; entry.meta is AUTHORED.
    entry.meta.cwd = "/x";
  });
});

describe("applyMirroredAwareness — kolu-persisted history vs pulam-derivable fold (R9.0)", () => {
  /** A pulam frame: derivable fields (cwd/git/pr/agent/foreground) fresh, the
   *  PERSISTED-HISTORY fields at the ephemeral pulam's empty seed — lastActivityAt
   *  0, no command, no session — exactly what a freshly-spawned pulam sends before
   *  it re-derives anything. */
  function pulamFrame(over: Partial<AwarenessValue> = {}): AwarenessValue {
    return {
      cwd: "/work",
      git: null,
      lastActivityAt: 0,
      lastAgentCommand: undefined,
      agentSession: undefined,
      pr: { kind: "pending" },
      agent: null,
      foreground: null,
      ...over,
    };
  }

  it("preserves kolu's restored history when pulam's first frame seeds it empty", async () => {
    // Simulate a restart restore: kolu loaded the persisted half from disk.
    const entry = getTerminal(ID) as ActiveTerminalProcess;
    entry.awareness.lastActivityAt = 1000;
    entry.awareness.lastAgentCommand = "claude --resume sess-A";
    entry.awareness.agentSession = { kind: "claude-code", id: "sess-A" };

    // The ephemeral pulam's FIRST frame: re-derived cwd, but empty history.
    applyMirroredAwareness(ID, pulamFrame({ cwd: "/restored/repo" }));

    const aw = getTerminal(ID)?.awareness;
    expect(aw?.cwd).toBe("/restored/repo"); // derivable → overwritten
    expect(aw?.lastActivityAt).toBe(1000); // history → preserved, NOT clobbered to 0
    expect(aw?.lastAgentCommand).toBe("claude --resume sess-A"); // resume offer kept
    expect(aw?.agentSession).toEqual({ kind: "claude-code", id: "sess-A" });
  });

  it("lastActivityAt is monotonic — a real activity bump advances it", () => {
    const entry = getTerminal(ID) as ActiveTerminalProcess;
    entry.awareness.lastActivityAt = 1000;
    applyMirroredAwareness(ID, pulamFrame({ lastActivityAt: 5000 }));
    expect(getTerminal(ID)?.awareness.lastActivityAt).toBe(5000);
  });

  it("a fresher command / session from pulam DOES win over the restored value", () => {
    const entry = getTerminal(ID) as ActiveTerminalProcess;
    entry.awareness.lastAgentCommand = "claude --resume old";
    applyMirroredAwareness(
      ID,
      pulamFrame({ lastAgentCommand: "codex resume new" }),
    );
    expect(getTerminal(ID)?.awareness.lastAgentCommand).toBe(
      "codex resume new",
    );
  });

  it("does NOT fire terminals:dirty for a live-only frame (the firehose fence)", async () => {
    // Prior == frame on every PERSISTED field; only a LIVE field (foreground)
    // differs — exactly an agent-stream tick.
    const entry = getTerminal(ID) as ActiveTerminalProcess;
    entry.awareness.cwd = "/work";
    entry.awareness.lastActivityAt = 0;
    dirtyCount = 0;
    applyMirroredAwareness(
      ID,
      pulamFrame({ cwd: "/work", foreground: { name: "vim", title: null } }),
    );
    await settle();
    expect(dirtyCount).toBe(0);
  });

  it("DOES fire terminals:dirty when a persisted field changes (cwd)", async () => {
    const entry = getTerminal(ID) as ActiveTerminalProcess;
    entry.awareness.cwd = "/old";
    dirtyCount = 0;
    applyMirroredAwareness(ID, pulamFrame({ cwd: "/new" }));
    await settle();
    expect(dirtyCount).toBe(1);
  });

  // ── git is the async-resolved persisted field — the relocated blocker ──
  function gitInfo(
    root = "/repo",
    branch = "main",
  ): NonNullable<AwarenessValue["git"]> {
    return {
      repoRoot: root,
      repoName: "repo",
      worktreePath: root,
      branch,
      isWorktree: false,
      mainRepoRoot: root,
      remoteUrl: null,
    };
  }

  it("preserves a restored NON-NULL git when pulam's first frame is git:null and the cwd is still in the repo (and does NOT persist the transient null)", async () => {
    // The restart blocker: kolu restored git; the ephemeral pulam's first frame
    // carries git:null before it re-resolves. cwd still inside the repo ⇒ the
    // resolution window, NOT a departure ⇒ preserve the restored git.
    const entry = getTerminal(ID) as ActiveTerminalProcess;
    entry.awareness.git = gitInfo("/repo", "feat-x");
    entry.awareness.cwd = "/repo/src";
    dirtyCount = 0;
    applyMirroredAwareness(ID, pulamFrame({ cwd: "/repo/src", git: null }));
    await settle();
    expect(getTerminal(ID)?.awareness.git?.branch).toBe("feat-x"); // not clobbered
    // The preserved git is UNCHANGED, so no persisted-field diff fires — the
    // transient null never reaches disk (the dirty-gate, achieved by the fold).
    expect(dirtyCount).toBe(0);
  });

  it("clears git once the cwd has LEFT the repo (a real departure, not the window)", () => {
    const entry = getTerminal(ID) as ActiveTerminalProcess;
    entry.awareness.git = gitInfo("/repo", "feat-x");
    entry.awareness.cwd = "/repo";
    applyMirroredAwareness(ID, pulamFrame({ cwd: "/tmp", git: null }));
    expect(getTerminal(ID)?.awareness.git).toBeNull(); // genuinely left → cleared
  });

  // ── every persisted field must ARM terminals:dirty (so a silent drop from
  //    the schema-derived diff fails CI) ── cwd is covered above; the rest: ──
  it("git change arms terminals:dirty", async () => {
    const entry = getTerminal(ID) as ActiveTerminalProcess;
    entry.awareness.cwd = "/tmp";
    dirtyCount = 0;
    applyMirroredAwareness(ID, pulamFrame({ cwd: "/tmp", git: gitInfo() }));
    await settle();
    expect(dirtyCount).toBe(1);
  });

  it("lastAgentCommand change arms terminals:dirty", async () => {
    const entry = getTerminal(ID) as ActiveTerminalProcess;
    entry.awareness.cwd = "/tmp";
    dirtyCount = 0;
    applyMirroredAwareness(
      ID,
      pulamFrame({ cwd: "/tmp", lastAgentCommand: "claude" }),
    );
    await settle();
    expect(dirtyCount).toBe(1);
  });

  it("agentSession change arms terminals:dirty", async () => {
    const entry = getTerminal(ID) as ActiveTerminalProcess;
    entry.awareness.cwd = "/tmp";
    dirtyCount = 0;
    applyMirroredAwareness(
      ID,
      pulamFrame({
        cwd: "/tmp",
        agentSession: { kind: "claude-code", id: "s1" },
      }),
    );
    await settle();
    expect(dirtyCount).toBe(1);
  });

  it("lastActivityAt advance arms terminals:dirty", async () => {
    const entry = getTerminal(ID) as ActiveTerminalProcess;
    entry.awareness.cwd = "/tmp";
    entry.awareness.lastActivityAt = 0;
    dirtyCount = 0;
    applyMirroredAwareness(
      ID,
      pulamFrame({ cwd: "/tmp", lastActivityAt: 9999 }),
    );
    await settle();
    expect(dirtyCount).toBe(1);
  });
});
