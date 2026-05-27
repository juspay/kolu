/**
 * Loopback test for the `kolu --stdio` agent — the agent's surface
 * impl is wired to a `PassThrough` pair in-process, no subprocess, no
 * `ssh`. Same framing as the real wire, so this proves:
 *
 *   - `agentSurface` is implementable end-to-end with `implementSurface`
 *     + the `implement(contract).router(...)` re-wrap.
 *   - `system.heartbeat` round-trips through `serveOverStdio` and
 *     `createStdioCellsClient` — i.e. the parent can drive the agent.
 *   - `terminalMetadata.keys({})` yields an empty snapshot first
 *     (snapshot-then-delta invariant — gives reconnect re-subscribers
 *     a fresh baseline even when the collection is empty).
 *
 * Slice 2c (heartbeat layer), 2d (RemoteTerminalBackend), and 2e
 * (metadata mirroring) extend this test against the same wire.
 */

import { implement } from "@orpc/server";
import { createStdioCellsClient } from "@kolu/surface/links/stdio";
import { createLoopbackPair } from "@kolu/surface/links/loopback";
import { serveOverStdio } from "@kolu/surface/peer-server";
import { implementSurface, inMemoryChannelByName } from "@kolu/surface/server";
import {
  agentSurface,
  type AgentContract,
  type AgentTerminalMetadata,
} from "kolu-common/agentSurface";
import type { TerminalId } from "kolu-common/surface";
import { describe, expect, it } from "vitest";

describe("kolu --stdio agent surface (loopback)", () => {
  it("round-trips system.heartbeat", async () => {
    const { router, pair, serveDone } = await startLoopbackAgent();
    try {
      const client = createStdioCellsClient<AgentContract>({
        read: pair.client.read,
        write: pair.client.write,
      });
      const reply = await client.surface.system.heartbeat({});
      expect(reply.ok).toBe(true);
      expect(reply.pid).toBe(process.pid);
    } finally {
      void router;
      pair.client.write.end();
      pair.server.write.end();
      await serveDone;
    }
  });

  it("terminalMetadata.keys yields an empty snapshot first", async () => {
    const { pair, serveDone } = await startLoopbackAgent();
    try {
      const client = createStdioCellsClient<AgentContract>({
        read: pair.client.read,
        write: pair.client.write,
      });
      const ac = new AbortController();
      const iterable = await client.surface.terminalMetadata.keys(
        {},
        { signal: ac.signal },
      );
      const it = iterable[Symbol.asyncIterator]();
      const first = await it.next();
      expect(first.done).toBe(false);
      expect(first.value).toEqual([]);
      ac.abort();
      // Drain the (now-aborted) iterator so the server stops yielding.
      try {
        for await (const _ of iterable) {
          /* drained */
        }
      } catch {
        /* abort surfaces as a rejection — acceptable */
      }
    } finally {
      pair.client.write.end();
      pair.server.write.end();
      await serveDone;
    }
  });
});

async function startLoopbackAgent() {
  const snapshot = new Map<TerminalId, AgentTerminalMetadata>();
  const fragment = implementSurface(agentSurface, {
    channel: inMemoryChannelByName(),
    collections: {
      terminalMetadata: {
        readAll: () => snapshot,
        upsert: (k, v) => {
          snapshot.set(k, v);
        },
        remove: (k) => {
          snapshot.delete(k);
        },
      },
    },
    procedures: {
      system: {
        heartbeat: async () => ({ ok: true, pid: process.pid }),
      },
    },
  });
  const router = implement(agentSurface.contract).router({
    ...fragment.router,
  });
  const pair = createLoopbackPair();
  const serveDone = serveOverStdio({
    // biome-ignore lint/suspicious/noExplicitAny: same Lazy<Router> cast as agent.ts.
    router: router as any,
    transport: pair.server,
  });
  return { router, pair, serveDone };
}
