/**
 * Publish-routing tests for the metadata update helpers.
 *
 * Guards against the firehose regressing: persisted-field writers MUST
 * fire `terminals:dirty`; live-field writers MUST NOT. Without this,
 * a future contributor who routes a new persisted field through
 * `updateServerLiveMetadata` (or vice versa) silently breaks autosave
 * cadence — either over-saving or losing data on restart.
 */

import { LOCAL_LOCATION } from "kolu-common/surface";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { terminalsDirtyChannel } from "../publisher.ts";
import type { TerminalProcess } from "../terminal-registry.ts";
import {
  __resetSurfaceCtxForTest,
  noopSurfaceCtxForTest,
  setSurfaceCtx,
} from "../surfaceCtx.ts";
import {
  updateClientMetadata,
  updateServerLiveMetadata,
  updateServerMetadata,
} from "./metadata.ts";

function fakeTerminal(): TerminalProcess {
  return {
    info: { id: "term-pub-test", pid: 0 },
    meta: {
      cwd: "/tmp",
      git: null,
      location: LOCAL_LOCATION,
      pr: { kind: "pending" },
      agent: null,
      foreground: null,
      lastActivityAt: 0,
    },
    // Tests never touch the PTY handle; the publish path doesn't read it.
    handle: {} as TerminalProcess["handle"],
  };
}

let dirtyCount: number;
let stopWatch: () => void;

/** Yield to the event loop so the channel's async iterator (started by
 *  `consume`) can receive any queued publishes. The publisher pipeline
 *  is async end-to-end (`publish` returns a Promise; the consume IIFE
 *  awaits via `for await`), so a synchronous read of `dirtyCount`
 *  immediately after `updateServerMetadata` will see the pre-event
 *  count. Two `setImmediate` ticks cover both legs of the pipe. */
async function settle(): Promise<void> {
  await new Promise<void>((resolve) => setImmediate(resolve));
  await new Promise<void>((resolve) => setImmediate(resolve));
}

beforeEach(async () => {
  // surface.ts is not imported by this test module; supply a no-op ctx
  // so calls to publishSnapshot (via surfaceCtx.collections…upsert) don't throw.
  setSurfaceCtx(noopSurfaceCtxForTest());
  dirtyCount = 0;
  stopWatch = terminalsDirtyChannel.consume({
    onEvent: () => {
      dirtyCount += 1;
    },
    onError: () => {},
  });
  // Let `consume`'s async IIFE reach its first `for await` before any
  // test publishes; otherwise the first publish races the subscribe.
  await settle();
});

afterEach(() => {
  // Each test gets a fresh subscriber; without this, prior subscribers
  // keep firing into the shared `dirtyCount` and bystander tests see
  // inflated counts.
  stopWatch?.();
  __resetSurfaceCtxForTest();
});

describe("metadata publish routing", () => {
  it("updateServerMetadata fires terminals:dirty (cwd is persisted)", async () => {
    const entry = fakeTerminal();
    updateServerMetadata(entry, "term-pub-test", (m) => {
      m.cwd = "/new/cwd";
    });
    await settle();
    expect(dirtyCount).toBe(1);
  });

  it("updateClientMetadata fires terminals:dirty (every client field is persisted)", async () => {
    const entry = fakeTerminal();
    updateClientMetadata(entry, "term-pub-test", (m) => {
      m.themeName = "dracula";
    });
    await settle();
    expect(dirtyCount).toBe(1);
  });

  it("updateServerLiveMetadata does NOT fire terminals:dirty (agent stream is live)", async () => {
    const entry = fakeTerminal();
    updateServerLiveMetadata(entry, "term-pub-test", (m) => {
      m.agent = {
        kind: "claude-code",
        state: "thinking",
        sessionId: "sess-A",
        model: null,
        summary: "tick",
        taskProgress: null,
        workflow: null,
        contextTokens: null,
      };
    });
    await settle();
    expect(dirtyCount).toBe(0);
  });

  it("updateServerLiveMetadata called repeatedly stays silent (the firehose case)", async () => {
    const entry = fakeTerminal();
    for (let i = 0; i < 50; i += 1) {
      updateServerLiveMetadata(entry, "term-pub-test", (m) => {
        m.foreground = { name: "claude", title: `tick ${i}` };
      });
    }
    await settle();
    expect(dirtyCount).toBe(0);
  });

  // Type-fence assertions — these are the structural guarantee that the
  // firehose can't grow back. If any of these `@ts-expect-error` lines
  // start compiling, the fence is broken and a future write site can
  // silently re-firehose live writes through the persisting path (or
  // vice versa). Test runtime is irrelevant; the assertion is at type
  // check.
  it("type fence: live fields cannot be written through updateServerMetadata", () => {
    const entry = fakeTerminal();
    updateServerMetadata(entry, "term-pub-test", (m) => {
      // @ts-expect-error — `agent` is live, not persisted.
      m.agent = null;
      // @ts-expect-error — `pr` is live, not persisted.
      m.pr = { kind: "pending" };
      // @ts-expect-error — `foreground` is live, not persisted.
      m.foreground = null;
    });
  });

  it("type fence: persisted fields cannot be written through updateServerLiveMetadata", () => {
    const entry = fakeTerminal();
    updateServerLiveMetadata(entry, "term-pub-test", (m) => {
      // @ts-expect-error — `cwd` is persisted, not live.
      m.cwd = "/tmp";
      // @ts-expect-error — `lastActivityAt` is persisted, not live.
      m.lastActivityAt = 0;
    });
  });
});
