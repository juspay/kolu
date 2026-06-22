/**
 * Tests for kolu's AUTHORED-metadata helpers.
 *
 * R8 removed the server-persisted/live FENCE (`updateServerMetadata` /
 * `updateServerLiveMetadata`): kolu no longer co-owns the observation, so there
 * is no two-writer record to fence. The sensors write the observation through
 * their own `AwarenessSink` (where the cwd write — and only it — arms the
 * autosave); the ~150 ms agent firehose never reaches kolu. What's left here:
 * `createMetadata` (authored birth) and `updateClientMetadata` (client chrome
 * writes, which DO arm the autosave).
 */

import { LOCAL_LOCATION } from "kolu-common/surface";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { terminalsDirtyChannel } from "../publisher.ts";
import type { ActiveTerminalProcess } from "../terminal-registry.ts";
import {
  __resetSurfaceCtxForTest,
  noopSurfaceCtxForTest,
  setSurfaceCtx,
} from "../surfaceCtx.ts";
import { createMetadata, updateClientMetadata } from "./metadata.ts";

function fakeTerminal(): ActiveTerminalProcess {
  return {
    info: { id: "term-pub-test", pid: 0 },
    // R8: the registry record is AUTHORED only — location + chrome + state. The
    // observation (cwd/git/pr/agent/foreground) lives in the awareness store.
    meta: { state: "active", location: LOCAL_LOCATION, themeName: "rose" },
    // Tests never touch the PTY handle; the publish path doesn't read it.
    handle: {} as ActiveTerminalProcess["handle"],
  };
}

let dirtyCount: number;
let stopWatch: () => void;

/** Yield to the event loop so the channel's async iterator can drain. */
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

describe("authored metadata helpers", () => {
  it("createMetadata returns the AUTHORED active arm — location + state, no observation", () => {
    const meta = createMetadata(LOCAL_LOCATION) as Record<string, unknown>;
    expect(meta).toEqual({ location: LOCAL_LOCATION, state: "active" });
    // none of the observed fields are seeded onto kolu's record
    for (const k of ["cwd", "git", "pr", "agent", "foreground"])
      expect(meta[k]).toBeUndefined();
  });

  it("updateClientMetadata writes a chrome field and arms the autosave", async () => {
    const entry = fakeTerminal();
    updateClientMetadata(entry, "term-pub-test", (m) => {
      m.intent = "ship it";
    });
    expect(entry.meta.intent).toBe("ship it");
    await settle();
    expect(dirtyCount).toBe(1);
  });
});
