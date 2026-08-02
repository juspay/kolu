/**
 * The `kolu mcp` arm — wire the connect layer to kolu-mcp's serve-function and
 * own the process lifetime. Loaded by `main.ts` only when the user asked for
 * this face (a dynamic import, so `kolu web` never touches the MCP graph and
 * vice versa).
 *
 * The restart discipline's edges live HERE, at the composition root:
 *
 *   - **Redial = re-resolve.** The connect factory runs the full resolve +
 *     dial + hello/compat gate on every invocation (see `connect.ts`) — the
 *     adapter re-invokes it after a transport drop, so a padi restart heals
 *     into a fresh generation with fresh snapshots.
 *   - **Gate failure exits LOUD.** A (re)dialed padi that no longer speaks our
 *     contract (`DaemonContractSkewError`) must never keep the MCP server
 *     serving a surface it can't honestly represent: stderr carries the honest
 *     "upgrade" line and the process exits non-zero.
 *   - **In-gap calls fail fast, typed, retryable.** A dial failure while padi
 *     is down/restarting is wrapped with the named `padi transport down:`
 *     prefix and surfaces as the tool call's error — nothing queues (a queued
 *     mutation replayed against a new daemon generation is the two-clocks
 *     bug).
 *   - **The stdio face's lifetime belongs to its transport**: when the MCP
 *     host closes the pipe, the process exits — mirroring `serveOverStdio`'s
 *     framework-owns-the-exit rule for stdio agents.
 */

import { isContractSkewError } from "@kolu/surface-daemon-supervisor";
import { type KoluMcpConnection, serveKoluMcp } from "kolu-mcp";
// The ONE version accessor — `kolu mcp`'s serverInfo can never diverge from
// what `kolu --version` reports (same leaf import the parse uses).
import { serverVersion } from "kolu-server/src/hostname.ts";
import { connectKoluCliLocal } from "./connect.ts";
import { connectKoluCliViaHost } from "./hostConnect.ts";

/** Wrap a dial with the face's failure policy — exported so the two arms are
 *  unit-testable apart from a real socket:
 *   - a CONTRACT SKEW is not a transient (every redial hits the same wall) →
 *     the honest "upgrade" line on stderr and a loud non-zero exit, never a
 *     server left serving a surface it can't represent;
 *   - anything else is the transport gap (padi down, restarting, socket
 *     moved) → rethrown fast with the typed `padi transport down:` prefix so
 *     the agent's tool call fails retryable — never queued.
 *
 * The skew test is the supervisor's own BRAND check, not `instanceof`: a CLI
 * face and the dial kit that raised the error can sit on different module
 * instances of `@kolu/surface-daemon-supervisor` (a bundled binary, a re-exported
 * copy), and an `instanceof` against one realm's class would silently misroute
 * a real skew into the retryable arm — an agent retrying forever against a
 * daemon that can never become compatible. */
export function guardedMcpConnect(
  dial: () => Promise<KoluMcpConnection>,
): () => Promise<KoluMcpConnection> {
  return async (): Promise<KoluMcpConnection> => {
    try {
      return await dial();
    } catch (err) {
      if (isContractSkewError(err)) {
        process.stderr.write(`kolu mcp: ${err.message}\n`);
        process.exit(1);
      }
      // Guard the message the agent actually reads — a non-`Error` rejection
      // (a thrown string, a rejected non-Error value) would make an unguarded
      // `(err as Error).message` read `undefined`, degrading the ONE diagnostic
      // that tells the operator/agent what broke. Same `instanceof` guard the
      // sibling `errMessage` helpers apply in the wait watchers.
      const detail = err instanceof Error ? err.message : String(err);
      throw new Error(
        `padi transport down: ${detail} (retryable — kolu mcp queues nothing; retry once padi is reachable)`,
      );
    }
  };
}

export async function runKoluMcp(opts: {
  host: string | undefined;
}): Promise<void> {
  const connect = guardedMcpConnect(
    opts.host === undefined
      ? connectKoluCliLocal
      : () => connectKoluCliViaHost(opts.host as string),
  );

  const { server } = await serveKoluMcp({
    connect,
    serverInfo: { name: "kolu-mcp", version: serverVersion },
  });

  // The MCP host closed the stdio transport → this face is over. Compose with
  // the adapter's own onclose (pusher stop + connection teardown), then exit.
  const inner = server.onclose;
  server.onclose = (): void => {
    inner?.();
    process.exit(0);
  };
}
