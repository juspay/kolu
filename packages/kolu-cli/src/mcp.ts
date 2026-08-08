/**
 * The `kolu mcp` arm — wire the connect layer to kolu-mcp's serve-function and
 * own the process lifetime. Loaded by `main.ts` only when the user asked for
 * this face (a dynamic import, so `kolu web` never touches the MCP graph and
 * vice versa).
 *
 * The restart discipline's edges live HERE, at the composition root:
 *
 *   - **Redial = re-resolve.** The connect effect is LAZY and runs the full
 *     resolve + dial + hello/compat gate on every run (see `connect.ts`) — the
 *     adapter re-invokes it after a transport drop, so a padi restart heals
 *     into a fresh generation with fresh snapshots.
 *   - **The drop is ANNOUNCED, not discovered.** The connection carries padi's
 *     `onClose`, so the adapter drops the dead one the moment the socket closes
 *     rather than by failing a request against it. Redial says where a restart
 *     heals; this says when the adapter finds out — and without it the first
 *     padi-backed request after every restart was destroyed (juspay/kolu#2082),
 *     which agents read as "the MCP server died" and answered by abandoning MCP.
 *     Local arm only: the ssh `--host` dial has no close signal yet.
 *   - **Gate failure exits LOUD.** A (re)dialed padi that no longer speaks our
 *     contract (`PadiContractSkew`) must never keep the MCP server serving a
 *     surface it can't honestly represent: stderr carries the honest "upgrade"
 *     line and the process exits non-zero.
 *   - **In-gap calls fail fast, typed, retryable.** A dial failure while padi
 *     is down/restarting is wrapped with the named `padi transport down:`
 *     prefix and surfaces as the tool call's error — nothing queues (a queued
 *     mutation replayed against a new daemon generation is the two-clocks
 *     bug).
 *   - **The stdio face's lifetime belongs to its transport**: when the MCP
 *     host closes the pipe, the process exits — mirroring `serveOverStdio`'s
 *     framework-owns-the-exit rule for stdio agents.
 */

import { type KoluMcpConnection, serveKoluMcp } from "kolu-mcp";
// The ONE version accessor — `kolu mcp`'s serverInfo can never diverge from
// what `kolu --version` reports (same leaf import the parse uses).
import { serverVersion } from "kolu-server/src/hostname.ts";
import { Effect } from "effect";
import {
  connectKoluCliLocal,
  type KoluCliDialError,
  type KoluCliConnection,
} from "./connect.ts";
import { connectKoluCliViaHost } from "./hostConnect.ts";

/** Wrap a dial with the face's failure policy — exported so the two arms are
 *  unit-testable apart from a real socket:
 *   - a CONTRACT SKEW is not a transient (every redial hits the same wall) →
 *     the honest "upgrade" line on stderr and a loud non-zero exit, never a
 *     server left serving a surface it can't represent;
 *   - anything else is the transport gap (padi down, restarting, socket
 *     moved) → failed fast with the typed `padi transport down:` prefix so
 *     the agent's tool call fails retryable — never queued.
 *
 * The skew test is a `_tag` compare, and that is the point. It used to be a
 * `try`/`catch` running the supervisor's BRAND check here, because an
 * `instanceof` against one realm's class would silently misroute a real skew
 * into the retryable arm — an agent retrying forever against a daemon that can
 * never become compatible. The brand check still exists, but it now runs ONCE,
 * where the rejection is raised (`connect.ts`'s `classifyDialFailure`), and what
 * reaches here is a tagged value. A tag compare cannot be defeated by a second
 * module instance, so the misroute is no longer a hazard to remember — it is
 * unspellable. */
export function guardedMcpDial(
  dial: Effect.Effect<KoluCliConnection, KoluCliDialError>,
): Effect.Effect<KoluMcpConnection, Error> {
  return Effect.catch(dial, (err) =>
    err._tag === "PadiContractSkew"
      ? Effect.sync((): never => {
          process.stderr.write(`kolu mcp: ${err.message}\n`);
          process.exit(1);
        })
      : Effect.fail(
          new Error(
            `padi transport down: ${err.message} (retryable — kolu mcp queues nothing; retry once padi is reachable)`,
          ),
        ),
  );
}

export function runKoluMcp(opts: {
  host: string | undefined;
}): Effect.Effect<void> {
  const host = opts.host;
  const dial = guardedMcpDial(
    host === undefined ? connectKoluCliLocal : connectKoluCliViaHost(host),
  );

  return Effect.flatMap(
    Effect.promise(() =>
      serveKoluMcp({
        // THE MCP-SDK CALLBACK EDGE, and the only run in this package's src.
        // `serveSurfaceAsMcp` asks for `() => Promise<KoluMcpConnection>` and
        // OWNS the connection it gets (it disposes and re-invokes this on its
        // own redial path), so the crossing cannot be composed away from kolu-cli
        // without changing kolu-mcp's face. Each invocation runs the lazy dial
        // fresh — which IS the restart discipline's re-resolve.
        connect: () => Effect.runPromise(dial),
        serverInfo: { name: "kolu-mcp", version: serverVersion },
      }),
    ),
    ({ server }) =>
      // The MCP host closed the stdio transport → this face is over. Compose
      // with the adapter's own onclose (pusher stop + connection teardown),
      // then exit.
      //
      // This effect COMPLETES once the hook is wired, and deliberately so: the
      // face's lifetime belongs to its transport, not to this fiber. A
      // successful main leaves `runMain`'s default teardown with code 0, which
      // does NOT call `process.exit` — node keeps running while the stdio
      // transport holds its handles, exactly as the top-level `await` did. An
      // `Effect.never` here would replace that with a fiber that outlives every
      // handle, so a transport that ever closed WITHOUT firing `onclose` would
      // hang instead of exiting.
      Effect.sync(() => {
        const inner = server.onclose;
        server.onclose = (): void => {
          inner?.();
          process.exit(0);
        };
      }),
  );
}
