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
import { removeAwareness } from "../awarenessStore.ts";
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
  installAwareness,
  updateClientMetadata,
  updateServerLiveMetadata,
  updateServerMetadata,
} from "./metadata.ts";

const ID = "term-pub-test";

/** The AUTHORED half — location + active discriminant, no awareness field. */
function fakeTerminal(): ActiveTerminalProcess {
  return {
    info: { id: ID, pid: 0 },
    meta: { state: "active", location: LOCAL_LOCATION },
    // Tests never touch the PTY handle; the publish path doesn't read it.
    handle: {} as ActiveTerminalProcess["handle"],
  };
}

/** The AWARENESS half — seeded into the store under the same id. */
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
  // Design-S: the server mutators key on id and land in the awareness store; the
  // wire publish reads the registry. Seed BOTH halves for ID.
  registerTerminal(ID, fakeTerminal());
  installAwareness(ID, awValue());
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
  unregisterTerminal(ID);
  removeAwareness(ID);
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
