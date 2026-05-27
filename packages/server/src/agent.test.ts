/**
 * Loopback test for the `kolu --stdio` agent — the agent's surface
 * impl is wired to a `PassThrough` pair in-process, no subprocess, no
 * `ssh`. Same framing as the real wire.
 *
 * Covers: `system.heartbeat` round-trips; `terminalMetadata.keys({})`
 * yields an empty snapshot first (snapshot-then-delta invariant). The
 * full terminal lifecycle (spawn/data/kill) is covered by the e2e
 * smoke against a real PTY in CI's `ci::e2e` recipe — unit-testing PTY
 * lifecycle here would add fork-management complexity that doesn't pay
 * for itself.
 */

import { createLoopbackPair } from "@kolu/surface/links/loopback";
import { createStdioCellsClient } from "@kolu/surface/links/stdio";
import type {
  AgentContract,
  AgentTerminalMetadata,
} from "kolu-common/agentSurface";
import type { TerminalId } from "kolu-common/surface";
import { describe, expect, it } from "vitest";
import { buildAgentDeps, serveAgent } from "./agent.ts";

describe("kolu --stdio agent surface (loopback)", () => {
  it("round-trips system.heartbeat", async () => {
    const { pair, serveDone } = startLoopbackAgent();
    try {
      const client = createStdioCellsClient<AgentContract>({
        read: pair.client.read,
        write: pair.client.write,
      });
      const reply = await client.surface.system.heartbeat({});
      expect(reply.ok).toBe(true);
      expect(reply.pid).toBe(process.pid);
    } finally {
      pair.client.write.end();
      pair.server.write.end();
      await serveDone;
    }
  });

  it("terminalMetadata.keys yields an empty snapshot first", async () => {
    const { pair, serveDone } = startLoopbackAgent();
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

function startLoopbackAgent() {
  const terminals = new Map();
  const metadataSnapshot = new Map<TerminalId, AgentTerminalMetadata>();
  const deps = buildAgentDeps({
    terminals,
    metadataSnapshot,
    publishExit: () => {},
    publishMetadata: () => {},
  });
  const pair = createLoopbackPair();
  const { serveDone } = serveAgent(deps, { transport: pair.server });
  return { pair, serveDone };
}
