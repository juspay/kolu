/**
 * The `kolu mcp` arm — wire the connect layer to kolu-mcp's serve-function and
 * own the process lifetime. Loaded by `main.ts` only when the user asked for
 * this face (a dynamic import, so `kolu web` never touches the MCP graph and
 * vice versa).
 *
 * The restart discipline's edges live HERE, at the composition root:
 *
 *   - **Open fails loud when padi is unreachable (juspay/kolu#2148).** Before
 *     the MCP handshake, one probe dial must succeed; otherwise the failure
 *     rides the package exit contract (`CliFailure` → `main.ts` writes the
 *     line and exits non-zero). Spawn-and-check-exit is then a valid "is kolu
 *     usable on this host?" probe — a consumer never has to reimplement socket
 *     discovery, and never receives a tool list whose every call will fail.
 *     The probe connection is disposed; the adapter owns every connection it
 *     opens on its own redial path.
 *   - **Redial = re-resolve.** The connect effect is LAZY and runs the full
 *     resolve + dial + hello/compat gate on every run (see `connect.ts`) — the
 *     adapter re-invokes it after a transport drop, so a padi restart heals
 *     into a fresh generation with fresh snapshots. WHICH padi is the shared
 *     {@link Endpoint} the root's flags parsed, so this face honors `--socket` /
 *     `--state-root` / `--host` exactly as the eight verbs do; the re-resolve
 *     is of the same target, never of a different one.
 *   - **The drop is ANNOUNCED, not discovered.** The connection carries padi's
 *     `onClose`, so the adapter drops the dead one the moment the socket closes
 *     rather than by failing a request against it (juspay/kolu#2082 — see
 *     `OwnedSurfaceConnection.onClose` for the whole story). Local arm only: the
 *     ssh `--host` dial does not yet CARRY the announcement — the signal exists
 *     one layer down, `AgentDial` just has no field to project it through.
 *   - **Gate failure exits LOUD.** A (re)dialed padi that no longer speaks our
 *     contract (`PadiContractSkew`) must never keep the MCP server serving a
 *     surface it can't honestly represent: stderr carries the honest "upgrade"
 *     line and the process exits non-zero. Mid-session this still
 *     `process.exit`s at the Promise connect factory (outside the Effect tree
 *     `runMain` owns); open-time failures stay on the `CliFailure` channel.
 *   - **In-gap calls fail fast, typed, retryable.** A dial failure while padi
 *     is down/restarting *after* a successful open is wrapped with the named
 *     `padi transport down:` prefix and surfaces as the tool call's error —
 *     nothing queues (a queued mutation replayed against a new daemon generation
 *     is the two-clocks bug). That mid-session path is deliberately not an
 *     exit: a padi restart is data, not a reason to kill the MCP face.
 *   - **The stdio face's lifetime belongs to its transport**: when the MCP
 *     host closes the pipe, the process exits — mirroring `serveOverStdio`'s
 *     framework-owns-the-exit rule for stdio agents.
 */

import { writeSync } from "node:fs";
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
import type { Endpoint } from "./endpoint.ts";
import { CliFailure } from "./exit.ts";
import { connectKoluCliViaHost } from "./hostConnect.ts";

/** Exact stderr line both exit paths write — one prefix so open (`CliFailure`)
 *  and mid-session (`exitMcpLoud`) cannot drift. */
const mcpFaceLine = (message: string): string => `kolu mcp: ${message}\n`;

/** The MCP face's one-line diagnostic + exit-1 value — same shape verbs use,
 *  with the face-prefixed line spawn-and-check consumers already see. */
const mcpFaceFailure = (message: string): CliFailure =>
  new CliFailure({ reason: message, stderr: mcpFaceLine(message), code: 1 });

/** Mid-session only: kill the process from the Promise connect factory, where
 *  a `CliFailure` cannot reach `runMain`. Open-time failures use
 *  {@link mcpFaceFailure} on the Effect error channel instead.
 *
 *  `writeSync` + try/catch so a broken-pipe stderr (common under an MCP host)
 *  cannot skip `process.exit` and leave a skewed face alive, and so the line
 *  is flushed before the process tears down (async `stderr.write` is not). */
function exitMcpLoud(message: string): never {
  try {
    writeSync(process.stderr.fd, mcpFaceLine(message));
  } catch {
    // diagnostic best-effort — exit is load-bearing
  }
  process.exit(1);
}

/** Fail if padi cannot be reached — the #2148 open gate.
 *
 *  Distinct from {@link guardedMcpDial}: this runs ONCE before the MCP server
 *  starts, and EVERY dial failure (unaddressable, refused socket, contract
 *  skew) is a `CliFailure` that `main.ts` turns into the honest stderr line and
 *  a non-zero exit. Mid-session redials keep the softer policy so a padi
 *  restart does not tear down the agent face. Exported for unit tests and the
 *  in-process e2e composition twin. */
export function requireReachablePadi(
  dial: Effect.Effect<KoluCliConnection, KoluCliDialError>,
): Effect.Effect<void, CliFailure> {
  return Effect.flatMap(
    Effect.mapError(dial, (err) => mcpFaceFailure(err.message)),
    (conn) =>
      Effect.sync(() => {
        // Probe only — the adapter owns every connection it opens thereafter.
        conn.dispose();
      }),
  );
}

/** Wrap a dial with the face's mid-session failure policy — exported so the
 *  two arms are unit-testable apart from a real socket:
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
      ? Effect.sync((): never => exitMcpLoud(err.message))
      : Effect.fail(
          new Error(
            `padi transport down: ${err.message} (retryable — kolu mcp queues nothing; retry once padi is reachable)`,
          ),
        ),
  );
}

export function runKoluMcp(opts: {
  readonly endpoint: Endpoint;
}): Effect.Effect<void, CliFailure> {
  const endpoint = opts.endpoint;
  const rawDial =
    endpoint.kind === "host"
      ? connectKoluCliViaHost(endpoint.ssh)
      : connectKoluCliLocal(endpoint);
  const dial = guardedMcpDial(rawDial);

  return Effect.gen(function* () {
    // #2148 — refuse the face before the MCP handshake when padi is gone.
    yield* requireReachablePadi(rawDial);

    const { server } = yield* Effect.promise(() =>
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
    );

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
    yield* Effect.sync(() => {
      const inner = server.onclose;
      server.onclose = (): void => {
        inner?.();
        process.exit(0);
      };
    });
  });
}
