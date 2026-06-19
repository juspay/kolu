/**
 * `buildWatcherServer` is consumed exactly the way kolu-server's local endpoint
 * consumes it: served router → `directLink` (the no-wire identity link) → typed
 * client. This is the P4w proof — the host-side providers run behind the surface
 * and their awareness round-trips natively, no wire, no serialization. The same
 * client type backs an ssh `stdioLink` later, so a passing test here is the
 * link-swap's contract.
 */

import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import pino from "pino";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { buildWatcherServer } from "./server.ts";

const silent = pino({ level: "silent" });
const ID = "11111111-1111-4111-8111-111111111111";

/** The persisted-awareness seed a FRESH spawn passes — `createMetadata`'s
 *  defaults: no git, recency at 0, no agent command yet. */
const FRESH_SEED = { git: null, lastActivityAt: 0 } as const;

// A fresh empty dir as the watched cwd: a bare `mkdtemp` directory is never a
// git repo, so the git provider stays at its `git: null` seed and emits no
// persisted-awareness delta. Watching a shared path (e.g. `/tmp`) would make the
// command-run delta assertion below order-dependent on whether that path
// happened to be inside a git checkout on the host.
let cwd: string;
beforeEach(() => {
  cwd = mkdtempSync(join(tmpdir(), "watcher-server-"));
});
afterEach(() => {
  rmSync(cwd, { recursive: true, force: true });
});

/** Read the next value from a collection `get` stream's iterator. */
async function next<T>(it: AsyncIterator<T>): Promise<T> {
  const r = await it.next();
  if (r.done) throw new Error("stream ended unexpectedly");
  return r.value;
}

describe("buildWatcherServer over directLink", () => {
  it("seeds and serves a watched terminal's awareness, then pushes deltas", async () => {
    const watcher = buildWatcherServer({ log: silent });
    const client = watcher.client;
    try {
      await client.surface.terminal.watch({
        id: ID,
        pid: 4242,
        cwd,
        seed: FRESH_SEED,
      });

      // Persisted-awareness snapshot — the providers' seed: no git, no command,
      // recency at 0. (cwd / foreground / location are deliberately absent — the
      // endpoint owns those in-server.)
      const persisted = await client.surface.persistedAwareness.get({
        key: ID,
      });
      const pit = persisted[Symbol.asyncIterator]();
      const snap = await next(pit);
      expect(snap).toMatchObject({ git: null, lastActivityAt: 0 });
      expect(snap.lastAgentCommand).toBeUndefined();

      // Live-awareness snapshot — pr pending (the PR provider is about to poll),
      // no agent yet.
      const live = await client.surface.liveAwareness.get({ key: ID });
      const lsnap = await next(live[Symbol.asyncIterator]());
      expect(lsnap).toMatchObject({ pr: { kind: "pending" }, agent: null });

      // Relay a command-run signal for a known agent CLI. The host-side
      // agent-command tracker normalizes it and writes `lastAgentCommand`; the
      // persisted collection pushes a delta the directLink client observes.
      // Pull the delta BEFORE pushing, so the iterator is awaiting when it lands
      // (snapshot-then-delta has no buffer between pulls).
      const deltaP = next(pit);
      await client.surface.signal.commandRun({ id: ID, command: "claude" });
      const delta = await deltaP;
      expect(delta.lastAgentCommand).toBe("claude");
    } finally {
      watcher.dispose();
    }
  });

  it("drops a terminal's awareness on unwatch", async () => {
    const watcher = buildWatcherServer({ log: silent });
    const client = watcher.client;
    try {
      await client.surface.terminal.watch({
        id: ID,
        pid: 1,
        cwd,
        seed: FRESH_SEED,
      });
      await client.surface.signal.commandRun({ id: ID, command: "claude" });
      await client.surface.terminal.unwatch({ id: ID });

      // Re-watching reseeds from scratch — the unwatch cleared the prior
      // lastAgentCommand, so the fresh snapshot is back to the seed.
      await client.surface.terminal.watch({
        id: ID,
        pid: 1,
        cwd,
        seed: FRESH_SEED,
      });
      const persisted = await client.surface.persistedAwareness.get({
        key: ID,
      });
      const snap = await next(persisted[Symbol.asyncIterator]());
      expect(snap.lastAgentCommand).toBeUndefined();
    } finally {
      watcher.dispose();
    }
  });

  // Regression for the adoption (B3.3 redeploy-survival) clobber: a restored
  // survivor's non-zero `lastActivityAt` + saved `lastAgentCommand` must seed the
  // watcher and be reproduced by the eager snapshot — NOT reset to defaults. The
  // endpoint folds that snapshot back onto its metadata, so a defaults frame here
  // would overwrite the restored recency slot + agent label (and the autosave
  // would persist the loss). The watch `seed` is what carries the restored values
  // across; this asserts the watcher honours it.
  it("reproduces an adopted terminal's restored persisted awareness from the seed", async () => {
    const watcher = buildWatcherServer({ log: silent });
    const client = watcher.client;
    try {
      const restored = {
        git: null,
        lastAgentCommand: "claude --resume",
        lastActivityAt: 1_700_000_000_000,
      };
      await client.surface.terminal.watch({
        id: ID,
        pid: 99,
        cwd,
        seed: restored,
      });

      const persisted = await client.surface.persistedAwareness.get({
        key: ID,
      });
      const snap = await next(persisted[Symbol.asyncIterator]());
      // The snapshot reproduces the restored values, not `{ lastActivityAt: 0,
      // lastAgentCommand: undefined }` — so the endpoint's fold is a no-op and
      // the survivor keeps its recency slot + agent-command label.
      expect(snap.lastActivityAt).toBe(restored.lastActivityAt);
      expect(snap.lastAgentCommand).toBe(restored.lastAgentCommand);
    } finally {
      watcher.dispose();
    }
  });
});
