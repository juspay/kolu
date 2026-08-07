/**
 * `kaval-tui attach` — the raw-tty passthrough loop (R-4 Phase 2). The design
 * decisions live in `docs/atlas/src/content/atlas/pty-daemon-tui.mdx` (Phase 2
 * section) and are echoed at their sites below: device-query reply filtering,
 * the grid-carrying attach, one-shot notices only, exit-stream discrimination with
 * no auto-retry, and one deterministic restore on every exit path (the restore
 * itself — `@kolu/terminal-protocol`'s `SNAPSHOT_TTY_RESET` + un-raw — is the
 * caller's job, in `main.ts`, so it can also run on signals and crashes that
 * never return through this function).
 *
 * Factored over `AttachTty` (streams + size, no `process.*`) so the loop is
 * integration-testable against a real pty-host over a real unix socket with no
 * actual tty — see `attach.test.ts`.
 *
 * ## Three inventions this used to carry, and what replaced them
 *
 *   - **the ordered `wire` promise chain.** Keystroke writes are async and two
 *     racing ones must not reorder, so every write was `.then`-chained onto a
 *     growing promise. It is a QUEUE with one consumer, and saying so makes the
 *     ssh-style rule it exists for structural: bytes the user sent before `~.`
 *     land before the client leaves, because a FIFO queue drained by one writer
 *     fiber cannot do anything else. `drainWire`'s "await until the tail stops
 *     moving" loop — which existed because a chained promise has no end — is one
 *     `stop` message and a `Fiber.join`.
 *   - **`currentAbort`.** An `AbortController` re-created per attach attempt,
 *     reachable from three callbacks, purely so a detach could tear down
 *     whichever subscription happened to be live. The attempt is a fiber now, and
 *     losing a race interrupts it; the stream's own finalizer is the unsubscribe.
 *   - **the `for(;;)` re-attach loop.** Kept as recursion, deliberately NOT
 *     `Effect.retry`: this is a re-subscribe on a CLEAN stream end, not a retry
 *     of a failure, and the inventory pre-flight in front of it is what
 *     discriminates PTY-exit from slow-consumer-drop. A retry policy would
 *     describe neither.
 */
import { StringDecoder } from "node:string_decoder";
import { isDeadTransportError } from "@kolu/surface/errors";
import { firstFrameOrUndefined } from "@kolu/surface/first-frame";
import { createTerminalResponseStripper } from "@kolu/terminal-protocol";
import { Data, Deferred, Effect, Fiber, Queue, Stream } from "effect";
import type { PtyTuiClient } from "./connect.ts";
import { createEscapeScanner } from "./escape.ts";

/** The local terminal, abstracted: `main.ts` binds the real process streams;
 *  tests bind PassThroughs and a fixed size. */
export interface AttachTty {
  /** Raw keyboard bytes from the user (no encoding set — Buffer chunks). */
  input: NodeJS.ReadableStream;
  /** Write VT bytes to the user's terminal (the passthrough sink). Completes on
   *  DRAIN, which is what makes a slow local terminal slow this consumer down
   *  rather than balloon memory — the backpressure property the deltas loop
   *  depends on. */
  write(data: string): Effect.Effect<void>;
  /** Current local dimensions. */
  size(): { cols: number; rows: number };
  /** Subscribe to local size changes; returns unsubscribe. */
  onResize(cb: () => void): () => void;
  /** Switch the local tty in/out of raw mode (no-op in tests). */
  setRawMode(on: boolean): void;
}

export type AttachOutcome =
  /** The id matched no live PTY (and we never attached — not an exit). */
  | { kind: "not-found" }
  /** `~.` (or stdin EOF): the CLI leaves, the daemon keeps the PTY. */
  | { kind: "detached" }
  /** The PTY's child exited; `exitCode` is the real code (exit tombstone). */
  | { kind: "exited"; exitCode: number }
  /** Transport/contract failure — `message` is ready to print. */
  | { kind: "error"; message: string };

export function helpText(escapeChar: string): string {
  const e = escapeChar;
  return (
    `\r\nkaval-tui escapes (recognised at line start only):\r\n` +
    `  ${e}.  detach — the daemon keeps the terminal\r\n` +
    `  ${e}${e}  send a literal ${e}\r\n` +
    `  ${e}?  this help\r\n`
  );
}

function describeError(err: unknown): string {
  const message = err instanceof Error ? err.message : String(err);
  // The link's dead-transport rejection (and the rawer shapes a mid-stream
  // socket death can surface) get the actionable copy; anything else prints
  // as-is. The tagged `SurfaceStdioTransportClosed` replaced the old
  // `code === SURFACE_STDIO_TRANSPORT_CLOSED` compare (PLAN D4).
  if (
    isDeadTransportError(err) ||
    /transport is closed|ECONNRESET|EPIPE|socket/i.test(message)
  ) {
    return `the daemon went away mid-attach (${message}) — re-run \`kaval-tui attach\` once it's back.`;
  }
  return message;
}

/** The PTY is gone — fetch its real exit code, or `undefined` if the `exit` stream
 *  ends without yielding one. Exit codes tombstone in the pty-host past teardown, so
 *  the one-shot `exit` stream resolves immediately here (it only blocks while the PTY
 *  is alive, which it no longer is); an EMPTY stream is a kaval contract violation
 *  (`exit` yields exactly once), which the caller surfaces as an `error` outcome
 *  rather than collapsing into a fabricated `exit 0`. */
function readExitCode(
  client: PtyTuiClient,
  id: string,
): Effect.Effect<number | undefined, unknown> {
  // The EFFECT one-shot reader, not the Promise one: this read happens inside
  // the attach's own fiber tree, so a Ctrl+C on the way out interrupts it
  // instead of leaving the CLI waiting on a wedged link.
  return Effect.map(
    firstFrameOrUndefined(client.surface.exit.get({ id })),
    (frame) => (frame as { exitCode?: number } | undefined)?.exitCode,
  );
}

export interface AttachOptions {
  escape?: string;
  tty: AttachTty;
}

/** One thing to put on the wire, in order. `stop` is the drain marker — the
 *  queue is FIFO, so a `stop` behind three keystrokes means those keystrokes are
 *  on the wire before the writer returns, which IS the ssh escape-ordering rule
 *  (`echo work\r~.` must land `echo work` on the remote). */
type WireOp =
  | { readonly kind: "write"; readonly data: string }
  | { readonly kind: "resize"; readonly cols: number; readonly rows: number }
  /** A local courtesy write (the `~?` help). It rides the SAME queue so the one
   *  writer fiber stays the only thing performing effects on the stdin path —
   *  otherwise a synchronous node callback would need a runtime of its own. As a
   *  bonus it is now ordered against the user's keystrokes rather than
   *  fire-and-forget. */
  | { readonly kind: "notice"; readonly text: string }
  | { readonly kind: "stop" };

/** The daemon dropped us for lagging (a typed `overflow` frame). It carries no
 *  data — it means "re-attach for a fresh snapshot", so it ends the ATTEMPT
 *  rather than the attach. */
class DroppedForLagging extends Data.TaggedError("DroppedForLagging")<{
  readonly id: string;
}> {}

/** A non-snapshot first frame — the same fail-loud stance as the web path
 *  (`terminalEndpoint/local.ts`): a contract violation, not something to paint. */
class SnapshotContractViolation extends Data.TaggedError(
  "SnapshotContractViolation",
)<{ readonly message: string }> {}

/** How one attach ATTEMPT ended. `re-attach` is the clean stream end the loop
 *  re-subscribes on; the rest leave the loop. */
type AttemptEnd =
  | { readonly kind: "re-attach" }
  | { readonly kind: "outcome"; readonly outcome: AttachOutcome };

/**
 * Attach to PTY `id` and pump until detach, PTY exit, or transport death.
 * Re-attaches by itself when the output stream drops with the PTY still live
 * (the slow-consumer drop: the pty-host bounds each subscriber's queue and
 * silently ends laggards — a fresh attach repaints from the snapshot, which is
 * exactly the right recovery). Never opts into stream auto-retry: a transparent
 * re-subscribe would replay the snapshot mid-session into a live screen.
 */
export function runAttach(
  client: PtyTuiClient,
  id: string,
  opts: AttachOptions,
): Effect.Effect<AttachOutcome, unknown> {
  const { tty } = opts;
  const escapeChar = opts.escape ?? "~";
  return Effect.scoped(
    Effect.gen(function* () {
      const scanner = createEscapeScanner(escapeChar);
      // Streaming reply-strip — see `onStdin`. Stateful across chunks, so it
      // lives for the whole attach, not per-chunk.
      const stripper = createTerminalResponseStripper();
      // Forwarded bytes → UTF-8 at the write boundary only: the scanner runs on
      // bytes, and a multibyte char split across stdin chunks must reassemble
      // before it crosses the wire as a string.
      const decoder = new StringDecoder("utf8");

      /** The user asked to leave (`~.`, or stdin EOF). */
      const detachRequested = yield* Deferred.make<void>();
      /** A wire write failed — the transport died under us. Its own signal, not
       *  a detach: the two produce different outcomes. */
      const wireFailed = yield* Deferred.make<void>();
      let transportError: unknown;

      const wire = yield* Queue.unbounded<WireOp>();
      const enqueue = (op: WireOp): void => {
        Queue.offerUnsafe(wire, op);
      };

      // ONE writer fiber over the ordered queue. Ordering is not a rule anyone
      // has to maintain here; it is what a single consumer of a FIFO does.
      const writer = yield* Effect.forkChild(
        Effect.gen(function* () {
          for (;;) {
            const op = yield* Queue.take(wire);
            if (op.kind === "stop") return;
            if (op.kind === "notice") {
              yield* tty.write(op.text);
              continue;
            }
            yield* Effect.catch(
              op.kind === "write"
                ? client.surface.terminal.write({ id, data: op.data })
                : client.surface.terminal.resize({
                    id,
                    cols: op.cols,
                    rows: op.rows,
                  }),
              (err) =>
                Effect.sync(() => {
                  transportError ??= err;
                  Deferred.doneUnsafe(wireFailed, Effect.void);
                }),
            );
          }
        }),
      );

      /** Leave: stop accepting work, let the writer finish what is already
       *  queued, then report. A write that failed surfaced through
       *  `transportError`; we report THAT instead of a clean detach. */
      const drainWire: Effect.Effect<AttachOutcome> = Effect.map(
        Effect.andThen(
          Effect.sync(() => enqueue({ kind: "stop" })),
          Fiber.join(writer),
        ),
        (): AttachOutcome =>
          transportError !== undefined
            ? { kind: "error", message: describeError(transportError) }
            : { kind: "detached" },
      );

      const detach = (): void => {
        Deferred.doneUnsafe(detachRequested, Effect.void);
      };

      // `AttachTty.input` carries Buffer chunks by contract (no encoding set —
      // the interface doc says so, and the byte machines below depend on it).
      const onStdin = (chunk: Buffer): void => {
        // Reply strip — the passthrough makes the user's REAL terminal answer the
        // device queries riding in the snapshot/deltas (DA1, DSR, XTVERSION…), but
        // the headless mirror already answered them server-side. Forwarding the
        // duplicate corrupts the inner program's stdin (the yazi escape-soup bug).
        // Unlike the browser path (`Terminal.tsx` onData), a raw tty read does NOT
        // give us one discrete reply per event — replies split across reads,
        // coalesce, or sit against a keystroke — so we run the STREAMING stripper
        // (boundary-aware, state across chunks) rather than the whole-chunk
        // predicate. Same response grammars, same client-suppressed ⇒
        // server-answered invariant.
        for (const ev of scanner.feed(stripper.push(chunk))) {
          if (ev.kind === "forward") {
            const data = decoder.write(ev.data);
            if (data !== "") enqueue({ kind: "write", data });
          } else if (ev.kind === "help") {
            enqueue({ kind: "notice", text: helpText(escapeChar) });
          } else {
            detach();
          }
        }
      };

      // stdin EOF can't happen on a healthy interactive tty; if the input stream
      // dies under us, leaving cleanly (server keeps the PTY) is the only sane
      // reading.
      const onStdinEnd = (): void => detach();

      // The local tty's wiring is a RESOURCE: acquired here, released by the
      // scope on every exit path this function has — a returned outcome, a
      // failure, or the whole command being interrupted. (The process-level
      // `exit` hook in `main.ts` is the belt for the paths a finalizer cannot
      // reach: `process.exit` and SIGKILL. Both stay.)
      yield* Effect.acquireRelease(
        Effect.sync(() => {
          const offResize = tty.onResize(() => {
            const { cols, rows } = tty.size();
            enqueue({ kind: "resize", cols, rows });
          });
          tty.setRawMode(true);
          tty.input.on("data", onStdin);
          tty.input.on("end", onStdinEnd);
          return offResize;
        }),
        (offResize) =>
          Effect.sync(() => {
            tty.input.off("data", onStdin);
            tty.input.off("end", onStdinEnd);
            offResize();
            tty.setRawMode(false);
          }),
      );

      let attachedOnce = false;

      /** A PTY that's gone is `not-found` if we never attached, else `exited`
       *  with the tombstone code. The deltas stream ends identically for the
       *  inventory miss and the isNotFound attach error, so both sites resolve
       *  it here. */
      const resolveGone: Effect.Effect<AttachOutcome, unknown> = Effect.suspend(
        () =>
          attachedOnce
            ? Effect.map(
                readExitCode(client, id),
                (exitCode): AttachOutcome =>
                  // A missing exit code is a kaval contract violation (`exit`
                  // yields once), not a real `exit 0` — surface it loudly instead
                  // of fabricating a clean exit.
                  exitCode === undefined
                    ? {
                        kind: "error",
                        message: `attach(${id}): exit stream ended before yielding an exit code (kaval contract violation)`,
                      }
                    : { kind: "exited", exitCode },
              )
            : Effect.succeed({ kind: "not-found" } as AttachOutcome),
      );

      /** Consume ONE attach subscription to its end. */
      const consumeAttach = (
        pid: number,
      ): Effect.Effect<AttemptEnd, unknown> => {
        let sawSnapshot = false;
        return Effect.matchEffect(
          // The grid rides ON the attach: `resizeTo` makes the host resize the
          // PTY and serialize as one act, so the snapshot is always laid out for
          // THIS tty's dimensions. This replaces the old resize-then-attach
          // pairing, which was two calls a caller had to remember to order
          // correctly and which raced whenever it didn't — the same defect that
          // made a hidden browser split render at a grid it never had. Note the
          // name is honest about the cost: this is a real resize of a SHARED PTY
          // (last-attach-wins), so a concurrently-attached browser tile may show
          // wrap artifacts until its own next attach or resize.
          Stream.runForEach(
            client.surface.terminalAttach.get({ id, resizeTo: tty.size() }),
            (msg: { kind: string; data?: string }) =>
              Effect.gen(function* () {
                if (!sawSnapshot) {
                  if (msg.kind !== "snapshot") {
                    return yield* Effect.fail(
                      new SnapshotContractViolation({
                        message: `attach(${id}): expected a snapshot first frame, got "${msg.kind}"`,
                      }),
                    );
                  }
                  sawSnapshot = true;
                  const snapshot = msg.data ?? "";
                  // One-shot notice (design decision: no persistent footer — the
                  // passthrough owns zero pixels while attached). It survives only
                  // until the clear below on most paints; the durable trailers are
                  // the detach/exit lines main.ts prints after restore.
                  const lines =
                    snapshot === "" ? 0 : snapshot.split("\n").length;
                  yield* tty.write(
                    `↻ snapshot restored — ${lines} line${lines === 1 ? "" : "s"} · PTY pid ${pid}${attachedOnce ? " unchanged" : ""}\r\n`,
                  );
                  // Home + clear before painting: the serialized snapshot is built
                  // to replay into a FRESH same-size terminal (its final cursor
                  // moves are relative, and the inner program's later absolute
                  // addressing assumes its row 1 is the screen's row 1). Painting
                  // mid-screen would misalign every absolute escape that follows.
                  yield* tty.write("\x1b[H\x1b[2J");
                  yield* tty.write(snapshot);
                  attachedOnce = true;
                  return;
                }
                // A typed `overflow` frame says the host dropped us for lagging (a
                // slow consumer). It carries no data — end this ATTEMPT rather than
                // writing `undefined`; the inventory pre-flight then confirms the
                // PTY is still live and we re-attach for a fresh snapshot. (A 3.x
                // daemon never emits it — and the 4.0 major bump makes such a peer
                // a clean skew, never a live attach.)
                if (msg.kind === "overflow") {
                  return yield* Effect.fail(new DroppedForLagging({ id }));
                }
                // Backpressure-aware: `tty.write` completes on drain, so a slow
                // local terminal slows this consumer rather than ballooning memory.
                // (The server side bounds its queue regardless; if we lag past it,
                // the stream drops and the loop re-attaches.)
                yield* tty.write(msg.data ?? "");
              }),
          ),
          {
            // A clean stream end: PTY exit or slow-consumer drop — the pre-flight
            // discriminates on the next pass.
            onSuccess: (): Effect.Effect<AttemptEnd> =>
              Effect.succeed({ kind: "re-attach" }),
            onFailure: (err): Effect.Effect<AttemptEnd, unknown> => {
              if (err instanceof DroppedForLagging) {
                return Effect.succeed({ kind: "re-attach" });
              }
              if (err instanceof SnapshotContractViolation) {
                return Effect.succeed({
                  kind: "outcome",
                  outcome: { kind: "error", message: err.message },
                });
              }
              // There is no `isNotFound(err)` arm any more, and that is not an
              // omission. A `StreamSpec` has no error channel to declare on, so
              // kaval raises `PtyNotFound` from a stream producer as an UNDECLARED
              // failure — a defect — which crosses a wire opaquely and takes the
              // multiplexed connection with it (kaval's W3 report §3). The old
              // `code === "NOT_FOUND"` compare therefore has nothing left to read.
              // Nothing regresses on the paths that matter: a PTY that never
              // existed is caught by the inventory pre-flight (`resolveGone` →
              // `not-found`), and a PTY that EXITS ends its attach stream CLEANLY
              // — no throw at all — so the loop falls to the pre-flight and reads
              // the exit tombstone. What lands here is the narrow race where the
              // PTY dies between the pre-flight and the subscribe, and it now
              // reports an honest transport failure rather than a code the wire no
              // longer carries.
              return Effect.succeed({
                kind: "outcome",
                outcome: {
                  kind: "error",
                  message: describeError(transportError ?? err),
                },
              });
            },
          },
        );
      };

      /** One pass: honour a pending detach, pre-flight the inventory, then
       *  consume an attach — racing all of it against the two ways the LOCAL
       *  side ends the session, so either interrupts the subscription through
       *  the stream's own finalizer. */
      const attempt: Effect.Effect<AttemptEnd, unknown> = Effect.gen(
        function* () {
          // Inventory pre-flight: an honest not-found before any screen takeover,
          // the pid for the attach notice, and — on re-attach — the live/exited
          // discrimination (the deltas stream ends identically for PTY exit,
          // server abort, and the silent slow-consumer drop; whether the PTY is
          // still listed is what tells them apart).
          const listed = yield* Effect.catch(
            client.surface.terminal.list({}),
            (err) =>
              Effect.succeed({
                failure: describeError(err),
                entries: [] as { id: string; pid: number }[],
              }),
          );
          if ("failure" in listed) {
            return {
              kind: "outcome",
              outcome: { kind: "error", message: listed.failure },
            } as AttemptEnd;
          }
          const entry = listed.entries.find((e) => e.id === id);
          if (entry === undefined) {
            return {
              kind: "outcome",
              outcome: yield* resolveGone,
            } as AttemptEnd;
          }
          return yield* consumeAttach(entry.pid);
        },
      );

      const loop: Effect.Effect<AttachOutcome, unknown> = Effect.gen(
        function* () {
          for (;;) {
            // A detach can land between attempts (the previous stream already
            // ended, or none has started) — honour it before dialing a fresh
            // attach the earlier detach could not have reached.
            if (yield* Deferred.isDone(detachRequested))
              return yield* drainWire;

            const end = yield* Effect.raceAllFirst<
              Effect.Effect<AttemptEnd | "detached" | "wire-failed", unknown>
            >([
              attempt,
              Effect.as(Deferred.await(detachRequested), "detached" as const),
              Effect.as(Deferred.await(wireFailed), "wire-failed" as const),
            ]);

            if (end === "detached") return yield* drainWire;
            if (end === "wire-failed") {
              return {
                kind: "error",
                message: describeError(transportError),
              };
            }
            // A detach that landed while the attempt was finishing still wins:
            // the user asked to leave, and the bytes they sent first must land.
            if (yield* Deferred.isDone(detachRequested))
              return yield* drainWire;
            if (end.kind === "outcome") return end.outcome;
            // Clean stream end — loop back. The pause keeps a pathological
            // immediate-drop server from spinning us hot.
            yield* Effect.sleep(150);
          }
        },
      );

      return yield* loop;
    }),
  );
}
