/**
 * A member's DEFECT must not take down the connection it shares (W6/D3).
 *
 * A surface multiplexes every cell, collection, stream and event over ONE
 * transport. Effect RPC's default answers an unhandled handler defect with a
 * connection-level `Defect` message — which fails every OTHER in-flight request
 * on that connection and closes the socket. `surfaceRpcServerLayer` turns that
 * off (`disableFatalDefects: true`), so a defect is delivered as the ONE
 * request's own exit.
 *
 * The bug this pins is not hypothetical: killing kolu's `kaval` daemon made
 * padi's `terminalAttach` producer die (`streamFromAbortableSource` is
 * `Stream.orDie` at the producer edge), which collapsed kolu-server's WHOLE
 * padi mirror — including the `daemonStatus` collection that was supposed to
 * report the death — so the browser never painted the degraded canvas.
 *
 * Driven over a REAL `net.Server` + `net.Socket` pair, because the fatal-defect
 * behaviour is a property of the serving stack, not of a handler in isolation.
 */
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Effect, Schema, Stream } from "effect";
import { describe, expect, it } from "vitest";
import { defineSurface } from "./define";
import { unixSocketLink } from "./links/unix-socket";
import { implementSurface } from "./server";
import { serveOverUnixSocket } from "./unix-socket";

const surface = defineSurface({
  cells: {
    /** The innocent bystander — nothing to do with the member that dies. */
    status: { schema: Schema.String, default: "boot" },
  },
  streams: {
    /** Stands in for padi's `terminalAttach`: a producer whose upstream can die. */
    tap: { inputSchema: Schema.Void, outputSchema: Schema.String },
  },
});

const STATUS_TAG = "surface/status/get";
const TAP_TAG = "surface/tap/get";

/** Serve the surface over a real unix socket, subscribe BOTH members over a
 *  real link, then kill the `tap` producer with an undeclared defect and write
 *  the bystander cell. Returns what each subscriber saw. */
async function runDefectIsolation() {
  let stored = "boot";
  let killTap!: () => void;
  const tapDoomed = new Promise<void>((resolve) => {
    killTap = resolve;
  });

  const runtime = implementSurface(surface, {
    cells: {
      status: {
        store: {
          get: () => stored,
          set: (v: string) => {
            stored = v;
          },
        },
      },
    },
    streams: {
      tap: {
        source: () =>
          Stream.concat(
            Stream.make("attached"),
            Stream.unwrap(
              Effect.map(
                Effect.promise(() => tapDoomed),
                (): Stream.Stream<string> =>
                  // An UNDECLARED defect — exactly what `Stream.orDie` at a
                  // producer edge yields when the producer's upstream dies.
                  Stream.die(new Error("the pty tap's daemon went away")),
              ),
            ),
          ),
      },
    },
  });

  const socketPath = join(mkdtempSync(join(tmpdir(), "surface-defect-")), "s");
  const listener = await serveOverUnixSocket({
    socketPath,
    group: runtime.group,
    handlers: runtime.handlers,
  });
  expect(listener.outcome).toEqual({ kind: "listening" });
  const link = await unixSocketLink({ group: surface.group, socketPath });

  const statusFrames: string[] = [];
  const statusFiber = Effect.runFork(
    Stream.runForEach(link.dispatch.stream(STATUS_TAG, undefined), (frame) =>
      Effect.sync(() => statusFrames.push(frame as string)),
    ),
  );
  const tapFrames: string[] = [];
  let tapFailed = false;
  Effect.runFork(
    Stream.runForEach(link.dispatch.stream(TAP_TAG, undefined), (frame) =>
      Effect.sync(() => tapFrames.push(frame as string)),
    ).pipe(
      Effect.catchCause(() =>
        Effect.sync(() => {
          tapFailed = true;
        }),
      ),
    ),
  );

  const settle = () => new Promise((r) => setTimeout(r, 300));
  await settle();
  killTap();
  await settle();
  // The bystander's authority publishes AFTER the defect landed.
  runtime.ctx.cells.status.set("still here");
  await settle();

  statusFiber.interruptUnsafe();
  await link.dispose();
  listener.close();
  return { statusFrames, tapFrames, tapFailed };
}

describe("a member's defect does not take down its connection", () => {
  it("keeps a sibling cell subscription flowing after a stream handler dies", async () => {
    const seen = await runDefectIsolation();
    // The dying member fails — loudly, and only for the subscriber that asked.
    expect(seen.tapFrames).toEqual(["attached"]);
    expect(seen.tapFailed).toBe(true);
    // …and the bystander keeps receiving. Without `disableFatalDefects` this
    // reads `["boot"]`: the connection-level Defect had already killed it.
    expect(seen.statusFrames).toEqual(["boot", "still here"]);
  }, 20_000);
});
