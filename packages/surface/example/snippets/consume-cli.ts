/**
 * Consuming the example surface outside SolidJS — the blocks the
 * "How to consume a surface outside SolidJS" page embeds. A CLI/TUI has no
 * reactive runtime, so it reads the surface directly off the member face:
 * one transport-blind connection, composed procedure calls, run streams, and a
 * live board folded through `mirrorRemoteSurface`.
 *
 * The face is deliberately STRUCTURAL (`face.surface.<member>.<verb>` is
 * `unknown`): per-member precision lives in the spec-derived bound hooks a Solid
 * consumer gets, and a second precise mapped type over the same spec is the
 * union-budget blow-up the framework avoids. So a non-reactive consumer NAMES
 * the shape of each member it uses, once — after which every call site is fully
 * typed.
 *
 * **Every member call is a description.** A unary verb hands back an `Effect`,
 * a streaming verb a `Stream`; neither dispatches anything until it is run. So a
 * CLI COMPOSES its whole command and runs it ONCE, at its process edge — which is
 * what makes a Ctrl-C actually stop the work rather than abandon a promise nobody
 * is left waiting on.
 *
 * Typechecked, never executed.
 */

import {
  buildSurfaceFace,
  type StreamingProcedure,
  type SurfaceFace,
  type UnaryEffect,
  unenrolledStreamCall,
} from "@kolu/surface/client";
import { firstFrameOrThrow } from "@kolu/surface/first-frame";
import { unixSocketLink } from "@kolu/surface/links/unix-socket";
import { mirrorRemoteSurface } from "@kolu/surface/mirror";
import { Effect, Stream } from "effect";
import {
  type KillArgs,
  type Killed,
  type LogFrame,
  type NodeIdArg,
  type Pid,
  type Proc,
  surface,
} from "./surface";

const socketPath = "/run/example/daemon.sock";
const nodeId = "node-1";
const pid = 4321;
const signal = new AbortController().signal;

// A plain (non-reactive) board the CLI folds frames into.
const board = {
  set: (_pid: Pid, _proc: Proc): void => {},
  delete: (_pid: Pid): void => {},
  appendLog: (_frame: LogFrame): void => {},
};
const render = (_frame: LogFrame): void => {};
const resetView = (): void => {};

// #region connection
type Connection = {
  client: SurfaceFace;
  dispose: () => Promise<void>;
};

// local: dial the daemon's unix socket, then re-nest the flat wire tags into
// `client.surface.<member>.<verb>`. Every link factory returns the same
// `{ dispatch, dispose }` pair, so swapping transport is a one-line change.
const link = await unixSocketLink({ group: surface.group, socketPath });
const client = buildSurfaceFace(surface, link.dispatch);
const dispose = () => link.dispose();
// #endregion connection

// Name each member's shape ONCE — the face is structural on purpose.
const kill = client.surface.proc?.kill as UnaryEffect<KillArgs, Killed, never>;
const processKeys = client.surface.processes?.keys as StreamingProcedure<
  undefined,
  readonly Pid[]
>;
const nodeLog = client.surface.nodeLog?.get as StreamingProcedure<
  NodeIdArg,
  LogFrame
>;

// #region calls
// A unary verb is a lazy `Effect`; a streaming verb is a lazy `Stream`, and a
// snapshot-then-deltas member opens with its snapshot — so `firstFrameOrThrow`
// IS the one-shot read, and it interrupts the subscription as soon as that frame
// lands. Nothing below has dispatched yet: this is one description, built.
const readKeys = Effect.gen(function* () {
  yield* kill({ pid });
  return yield* firstFrameOrThrow(
    processKeys(undefined),
    "processes keys yielded no snapshot frame — link failure",
  );
});
// #endregion calls

// #region iterate
// Consume every frame. Running the stream IS the subscription; interrupting the
// fiber (or the effect completing) tears the wire subscription down — there is
// no `AbortSignal` to thread and none to forget.
const tailLog = Stream.runForEach(nodeLog(nodeId), (frame) =>
  Effect.sync(() => process.stdout.write(frame.text)),
);
// #endregion iterate

// #region unenrolled
// The framework's per-subscription RETRY FENCE, without enrolling the stream in
// any `client.health()` fact: a transport drop re-subscribes transparently
// (forever), a DECLARED error never does. `onRetry` fires between the failed
// attempt's last frame and the next attempt's first — clear the view there.
const fenced = unenrolledStreamCall(nodeLog, nodeId, {
  onRetry: () => resetView(),
});
const renderLog = Stream.runForEach(fenced, (frame) =>
  Effect.sync(() => render(frame)),
);
// #endregion unenrolled

// #region mirror
const { procedures, done } = mirrorRemoteSurface(
  surface,
  client,
  {
    collections: {
      processes: {
        upsert: (p, proc) => board.set(p, proc),
        remove: (p) => board.delete(p),
      },
    },
    streams: { nodeLog: { input: nodeId, onFrame: (f) => board.appendLog(f) } },
  },
  // The mirror's own cancellation vocabulary for non-Effect callers — it is
  // translated into ONE fiber interrupt at this edge.
  { signal },
);

// The mirrored procedures are the SAME shape the face hands back — an `Effect` —
// so a forwarded call composes into the program exactly like a direct one.
const killThroughMirror = procedures.proc.kill({ pid });
// #endregion mirror

// #region main
// THE process edge: one run, for the whole command. Everything above is a value;
// this is the only line that makes anything happen — and interrupting this fiber
// (a SIGINT handler, a deadline) tears down every subscription it opened.
const keys = await Effect.runPromise(
  Effect.gen(function* () {
    const snapshot = yield* readKeys;
    yield* tailLog;
    yield* renderLog;
    yield* killThroughMirror;
    return snapshot;
  }),
);
await done;
// #endregion main

export type { Connection };
export { client, dispose, done, keys, procedures };
