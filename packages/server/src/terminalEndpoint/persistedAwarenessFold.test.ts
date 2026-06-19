/**
 * The persisted-awareness fold's autosave fence (the major's durability vector).
 *
 * `makePersistedAwarenessFold` MUST reconcile the FIRST frame — the snapshot the
 * watcher seeded from the endpoint's own `watch` seed — WITHOUT firing
 * `terminals:dirty`: adoption (`adoptTerminal`) deliberately omits a mid-boot
 * autosave, and routing the seed through `updateServerMetadata` would re-arm the
 * exact path that durably persists the B3.3 adoption clobber over the restored
 * session file. Every LATER frame is a genuine provider change and MUST fire
 * dirty (matching master). Without this test, the "obvious" simplification of
 * folding the first frame through `updateServerMetadata` regresses silently.
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
import { makePersistedAwarenessFold } from "./local.ts";

const ID = "term-fold-test";

function fakeTerminal(): TerminalProcess {
  return {
    info: { id: ID, pid: 0 },
    meta: {
      cwd: "/tmp",
      git: null,
      location: LOCAL_LOCATION,
      pr: { kind: "pending" },
      agent: null,
      foreground: null,
      lastActivityAt: 0,
    },
    handle: {} as TerminalProcess["handle"],
  };
}

let dirtyCount: number;
let stopWatch: () => void;

/** Two `setImmediate` ticks cover both async legs of the publisher pipeline,
 *  matching `metadata.test.ts` (the dirty channel's `publish` → `consume`). */
async function settle(): Promise<void> {
  await new Promise<void>((resolve) => setImmediate(resolve));
  await new Promise<void>((resolve) => setImmediate(resolve));
}

beforeEach(async () => {
  setSurfaceCtx(noopSurfaceCtxForTest());
  dirtyCount = 0;
  stopWatch = terminalsDirtyChannel.consume({
    onEvent: () => {
      dirtyCount += 1;
    },
    onError: () => {},
  });
  await settle();
});

afterEach(() => {
  stopWatch?.();
  __resetSurfaceCtxForTest();
});

describe("makePersistedAwarenessFold — the adoption autosave fence", () => {
  it("the FIRST frame (the watcher's seed snapshot) reconciles silently — NO terminals:dirty", async () => {
    const entry = fakeTerminal();
    const fold = makePersistedAwarenessFold(entry, ID);

    // The snapshot is the restored survivor's own persisted awareness — folding
    // it must NOT arm an autosave mid-adoption.
    fold({
      git: null,
      lastActivityAt: 1_700_000_000_000,
      lastAgentCommand: "claude --resume",
    });
    await settle();

    expect(dirtyCount).toBe(0);
    // It still reconciled onto entry.meta (so a raced first-frame value lands) —
    // just without firing dirty.
    expect(entry.meta.lastActivityAt).toBe(1_700_000_000_000);
    expect(entry.meta.lastAgentCommand).toBe("claude --resume");
  });

  it("a LATER frame (a genuine provider change) DOES fire terminals:dirty", async () => {
    const entry = fakeTerminal();
    const fold = makePersistedAwarenessFold(entry, ID);

    fold({ git: null, lastActivityAt: 0 }); // first frame — silent
    await settle();
    expect(dirtyCount).toBe(0);

    fold({ git: null, lastActivityAt: 42, lastAgentCommand: "claude" }); // delta
    await settle();
    expect(dirtyCount).toBe(1);
    expect(entry.meta.lastActivityAt).toBe(42);
    expect(entry.meta.lastAgentCommand).toBe("claude");
  });
});
