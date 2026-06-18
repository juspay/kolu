/**
 * `buildWatcherServer` is consumed exactly the way kolu-server's local endpoint
 * consumes it: served router → `directLink` (the no-wire identity link) → typed
 * client. This is the P4w proof — the host-side providers run behind the surface
 * and their awareness round-trips natively, no wire, no serialization. The same
 * client type backs an ssh `stdioLink` later, so a passing test here is the
 * link-swap's contract.
 */

import { directLink } from "@kolu/surface/links/direct";
import pino from "pino";
import { describe, expect, it } from "vitest";
import { buildWatcherServer } from "./server.ts";
import type { WatcherContract } from "./watcherSurface.ts";

const silent = pino({ level: "silent" });
const ID = "11111111-1111-4111-8111-111111111111";

/** Read the next value from a collection `get` stream's iterator. */
async function next<T>(it: AsyncIterator<T>): Promise<T> {
  const r = await it.next();
  if (r.done) throw new Error("stream ended unexpectedly");
  return r.value;
}

describe("buildWatcherServer over directLink", () => {
  it("seeds and serves a watched terminal's awareness, then pushes deltas", async () => {
    const watcher = buildWatcherServer({ log: silent });
    const client = directLink<WatcherContract>(watcher.router);
    try {
      await client.surface.terminal.watch({ id: ID, pid: 4242, cwd: "/tmp" });

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
    const client = directLink<WatcherContract>(watcher.router);
    try {
      await client.surface.terminal.watch({ id: ID, pid: 1, cwd: "/tmp" });
      await client.surface.signal.commandRun({ id: ID, command: "claude" });
      await client.surface.terminal.unwatch({ id: ID });

      // Re-watching reseeds from scratch — the unwatch cleared the prior
      // lastAgentCommand, so the fresh snapshot is back to the seed.
      await client.surface.terminal.watch({ id: ID, pid: 1, cwd: "/tmp" });
      const persisted = await client.surface.persistedAwareness.get({
        key: ID,
      });
      const snap = await next(persisted[Symbol.asyncIterator]());
      expect(snap.lastAgentCommand).toBeUndefined();
    } finally {
      watcher.dispose();
    }
  });
});
