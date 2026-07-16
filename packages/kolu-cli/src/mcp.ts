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

import { DaemonContractSkewError } from "@kolu/surface-daemon-supervisor";
import { type KoluMcpConnection, serveKoluMcp } from "kolu-mcp";
// The ONE version accessor — `kolu mcp`'s serverInfo can never diverge from
// what `kolu --version` reports (same leaf import the parse uses).
import { serverVersion } from "kolu-server/src/hostname.ts";
import { connectKoluCliLocal } from "./connect.ts";
import { connectKoluCliViaHost } from "./hostConnect.ts";

export async function runKoluMcp(opts: {
  host: string | undefined;
}): Promise<void> {
  const dial =
    opts.host === undefined
      ? connectKoluCliLocal
      : () => connectKoluCliViaHost(opts.host as string);

  const connect = async (): Promise<KoluMcpConnection> => {
    try {
      return await dial();
    } catch (err) {
      // A contract skew is not a transient: the daemon and this binary are out
      // of step, and every future redial hits the same wall. Fail the whole
      // face loudly (stderr — stdout is the protocol channel) rather than
      // serving a surface we can't honestly represent.
      if (err instanceof DaemonContractSkewError) {
        process.stderr.write(`kolu mcp: ${err.message}\n`);
        process.exit(1);
      }
      // Anything else is the transport gap (padi down, restarting, socket
      // moved): fail fast + typed so the agent retries — never queue.
      throw new Error(
        `padi transport down: ${(err as Error).message} (retryable — kolu mcp queues nothing; retry once padi is reachable)`,
      );
    }
  };

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
