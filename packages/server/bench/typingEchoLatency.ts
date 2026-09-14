/**
 * Typing-echo latency probe — the padi W1 baseline (owed by #1652, required
 * before W2.2 starts; see `docs/atlas/src/content/atlas/padi-latency-baseline.mdx`).
 *
 * WHAT IT MEASURES — the round-trip a single keystroke takes through the REAL
 * stack, entirely on **kolu-server's websocket wire** (`/rpc/ws`):
 *
 *     t0  ── lifecycle.sendInput({id, data: <char>})  (RPC dispatched from the client)
 *            │  kolu-server → padi → kaval → PTY line discipline echoes the char →
 *            │  kaval → padi → kolu-server → padiSurface.terminalAttach delta
 *     t1  ── the echoed char first appears in a `terminalAttach` DELTA frame
 *
 * latency = t1 − t0, both clocks read by THIS process (`process.hrtime.bigint()`),
 * so the number is a self-consistent monotonic delta — absolute skew is irrelevant.
 *
 * WHY BOTH CLOCK POINTS ARE ON KOLU-SERVER'S WIRE (not kaval's socket): W2.2 put
 * the padi process BETWEEN kolu-server and kaval. A probe that dialled kaval's unix
 * socket directly would bypass the very hop W2.2 added and report a fake zero delta.
 * Measuring `sendInput` → `terminalAttach` over kolu-server's `/rpc/ws` puts both
 * endpoints on the near side of that hop, so this IDENTICAL probe re-run against a
 * W2.2 build measures the added cost honestly (done-criterion (e): < 5ms added p99
 * vs the recorded baseline).
 *
 * HOW IT DIALS — the product's OWN transport, never a hand-rolled ndjson speaker:
 * `websocketLink` from `@kolu/surface` (the exact link the browser dials in
 * `packages/client/src/wire.ts`, with surface-app's `isStaleProcessClose` as the
 * terminal-close classifier), built over the padi HOST MAP's own group. padi is a
 * keyed `SurfaceMap`: its members are served at `surface/padi/<member>/<verb>`
 * behind the uniform `{ mapKey, input }` envelope, so this folds by hand through the
 * envelope's own `fold()` — the same move `packages/tests/support/rpcWire.ts` makes
 * for the e2e harness, which reaches members by tag rather than through the Solid
 * map client.
 *
 * EFFECT — a member call is a lazy `Effect` and a stream member a lazy `Stream`;
 * awaiting one dispatches NOTHING. So the whole probe is one Effect program with a
 * SINGLE run at the bottom of this file, which is its one process edge.
 *
 * The probe is a pure CLIENT: it connects to an already-running server (port via
 * `KOLU_BENCH_PORT`). `bench/run.sh` boots a private, nix-built kolu and invokes it;
 * re-run the whole thing with `just bench-typing-echo`.
 *
 * Config (env):
 *   KOLU_BENCH_PORT       server port (required)
 *   KOLU_BENCH_HOST       server host (default 127.0.0.1)
 *   KOLU_BENCH_TERMINALS  distinct terminals to spread samples over (default 5)
 *   KOLU_BENCH_SAMPLES    measured keystrokes per terminal (default 250)
 *   KOLU_BENCH_WARMUP     warmup keystrokes per terminal, discarded (default 50)
 *   KOLU_BENCH_TIMEOUT_MS per-keystroke echo timeout — fail loud (default 5000)
 *   KOLU_BENCH_INTERKEY_MS pacing gap between keystrokes, ms (default 2)
 *   KOLU_BENCH_OUT        write full JSON (incl. raw samples) to this path
 */

import fs from "node:fs";
import os from "node:os";
import type { TerminalAttachFrame } from "@kolu/padi/endpoint";
import {
  type TerminalInfo,
  TOPLEVEL_PLACEMENT,
} from "@kolu/padi-client/surface";
import type { SurfaceDispatch } from "@kolu/surface/link";
import { websocketLink } from "@kolu/surface/links/websocket";
import { isStaleProcessClose } from "@kolu/surface-app/connect";
import { fold } from "@kolu/surface-map";
import {
  Cause,
  Deferred,
  Effect,
  Exit,
  Schedule,
  Schema,
  Stream,
} from "effect";
import type { Rpc } from "effect/unstable/rpc";
import { encodeHostKey, LOCAL_HOST } from "kolu-common/hostKey";
import { padiHostMap } from "kolu-common/surfacesWithPadi";

// ── Config ────────────────────────────────────────────────────────────────
const HOST = process.env.KOLU_BENCH_HOST ?? "127.0.0.1";
const PORT = requireEnvInt("KOLU_BENCH_PORT");
const TERMINALS = envInt("KOLU_BENCH_TERMINALS", 5);
const SAMPLES = envInt("KOLU_BENCH_SAMPLES", 250);
const WARMUP = envInt("KOLU_BENCH_WARMUP", 50);
const TIMEOUT_MS = envInt("KOLU_BENCH_TIMEOUT_MS", 5000);
const INTERKEY_MS = envInt("KOLU_BENCH_INTERKEY_MS", 2);
const OUT = process.env.KOLU_BENCH_OUT;

/** How long the padi entry has to become reachable after the server listens, and
 *  how often it is asked. NOT a `KOLU_BENCH_*` knob: it bounds the boot window, not
 *  the measurement, so nothing about a recorded run depends on it. */
const PADI_READY_TIMEOUT_MS = 60_000;
const PADI_POLL_MS = 250;

// Rotating printable marker chars — a shell's readline echoes each typed
// character verbatim (raw-mode echo), so the char itself always appears in the
// echo frame. Rotating guards against matching a straggler from a prior key
// (the loop is serial, so there is never one outstanding — belt and braces).
const ALPHABET =
  "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789";
const BACKSPACE = "\x7f"; // DEL — readline erases the char, keeping the line ~1 wide

// ── The padi map's wire, reached by TAG ───────────────────────────────────

/** The map key this probe drives: the LOCAL host — kolu-server's unremovable seed,
 *  and the only entry a private bench server ever has. */
const HOST_KEY = encodeHostKey(LOCAL_HOST);

/** The wire tag a padi MAP entry member is served at. The prefix (`surface/padi/`)
 *  is read off the map's own declaration, never re-spelled here. */
const padiTag = (memberVerb: string): string =>
  `${padiHostMap.tagPrefix}${memberVerb}`;

/** Fold a call-site input into the map envelope and decode it at the edge, exactly
 *  as the typed client face does: the ENCODED `{ mapKey, input }` in, the DECODED
 *  value a `SurfaceDispatch` takes out. A void-input member passes no argument —
 *  `fold` then omits the `input` field, which is the shape the served schema
 *  declares. A mistyped tag fails HERE, naming the tag, rather than as an opaque
 *  defect inside Effect RPC's flat client. */
function padiPayload(memberVerb: string, input?: unknown): unknown {
  const tag = padiTag(memberVerb);
  const rpc = padiHostMap.group.requests.get(tag) as
    | Rpc.AnyWithProps
    | undefined;
  if (rpc === undefined) {
    throw new Error(`no padi member is served at tag "${tag}"`);
  }
  return Schema.decodeUnknownSync(
    rpc.payloadSchema as unknown as Schema.Codec<unknown, unknown>,
  )(fold(HOST_KEY, input));
}

/** Call a padi entry PROCEDURE — a lazy `Effect`; the payload is folded and decoded
 *  when the call is CONSTRUCTED, so the measured window holds only the dispatch. */
const padiCall = (
  dispatch: SurfaceDispatch,
  memberVerb: string,
  input?: unknown,
): Effect.Effect<unknown, unknown> =>
  dispatch.unary(padiTag(memberVerb), padiPayload(memberVerb, input));

/** Subscribe to a padi entry STREAM member — a lazy `Stream`; one wire subscription
 *  per run, torn down by the interruption of whatever fiber runs it. */
const padiStream = (
  dispatch: SurfaceDispatch,
  memberVerb: string,
  input: unknown,
): Stream.Stream<unknown, unknown> =>
  dispatch.stream(padiTag(memberVerb), padiPayload(memberVerb, input));

/** Dial the server's websocket wire as a SCOPED resource: the link is disposed when
 *  the scope closes, so a failed or interrupted run never leaks the socket. */
function dialWire(url: string) {
  return Effect.map(
    Effect.acquireRelease(
      Effect.promise(() =>
        websocketLink({
          group: padiHostMap.group,
          // A THUNK, as the browser passes: the link re-evaluates it on every
          // re-dial. This probe sends no `pid` echo, so it is never the stale tab
          // the server retires.
          url: () => url,
          // The app's own close-code vocabulary — the same classifier the browser's
          // link gets, so a retirement means here what it means there.
          isTerminalClose: isStaleProcessClose,
        }),
      ),
      (link) => Effect.promise(() => link.dispose()),
    ),
    (link) => link.dispatch,
  );
}

// ── The probe ─────────────────────────────────────────────────────────────

/** Reads the attach stream and completes a waiter when the expected char echoes. */
class EchoReader {
  /** Completed by the stream's opening frame — the scrollback snapshot. */
  readonly attached = Deferred.makeUnsafe<void>();
  private pending: { ch: string; at: Deferred.Deferred<bigint> } | null = null;

  /** Arm the watch for `ch`; the deferred completes with the hrtime of the frame it
   *  arrives in. Serial by design — at most one is ever armed. */
  expect(ch: string): Deferred.Deferred<bigint> {
    const at = Deferred.makeUnsafe<bigint>();
    this.pending = { ch, at };
    return at;
  }

  /** One attach frame, clocked on arrival. A `snapshot` frame is never a keystroke
   *  echo — it is the stream's opening scrollback seed (and, mid-stream, an overflow
   *  re-attach), so it is never matched against; only a `delta` carries typed bytes. */
  observe(frame: TerminalAttachFrame): void {
    const at = process.hrtime.bigint();
    if (frame.kind === "snapshot") {
      Deferred.doneUnsafe(this.attached, Effect.void);
      return;
    }
    const p = this.pending;
    if (p === null || !frame.data.includes(p.ch)) return;
    this.pending = null;
    Deferred.doneUnsafe(p.at, Effect.succeed(at));
  }
}

/** kolu-server answers `/rpc/ws` the moment it listens, but the padi entry behind
 *  the map key is dialled asynchronously (spawn/adopt + handshake), so the first
 *  call can land on a key that is still warming up. ONE bounded wait, on `killAll`:
 *  an answer proves the entry is live, and a private bench server starts from a
 *  clean slate either way.
 *
 *  `sandbox` first, because the warming-up rejections arrive on BOTH channels — the
 *  map's own `MapKeyUnknown` is a declared failure, while the re-serve's
 *  `UpstreamUnavailableError` ("no live upstream link") crosses as a DEFECT — and a
 *  plain `retry` would let the defect straight through, which is exactly how this
 *  probe fails half a second after the server starts listening. The last cause is
 *  carried into the timeout message: "padi never came up" must never be the whole
 *  story. */
function waitForPadi(dispatch: SurfaceDispatch): Effect.Effect<void, unknown> {
  let last: Cause.Cause<unknown> | undefined;
  return Effect.asVoid(
    Effect.timeoutOrElse(
      Effect.retry(
        Effect.tapError(
          Effect.sandbox(padiCall(dispatch, "lifecycle/killAll")),
          (cause) =>
            Effect.sync(() => {
              last = cause;
            }),
        ),
        Schedule.spaced(PADI_POLL_MS),
      ),
      {
        duration: PADI_READY_TIMEOUT_MS,
        orElse: () =>
          Effect.fail(
            new Error(
              `padi's entry for host "${HOST_KEY}" never answered within ${PADI_READY_TIMEOUT_MS}ms; last failure:\n${last === undefined ? "(none recorded)" : Cause.pretty(last)}`,
            ),
          ),
      },
    ),
  );
}

/** The measured loop for ONE terminal: serial keystrokes, one echo in flight. */
function keystrokes(
  dispatch: SurfaceDispatch,
  id: string,
  reader: EchoReader,
  term: number,
  out: number[],
): Effect.Effect<void, unknown> {
  return Effect.gen(function* () {
    // Frame #1 is the scrollback snapshot; typing before it lands would clock the
    // first keystroke against the snapshot's own serialization.
    yield* Effect.timeoutOrElse(Deferred.await(reader.attached), {
      duration: TIMEOUT_MS,
      orElse: () =>
        Effect.fail(
          new Error(
            `terminal ${id}: no attach snapshot within ${TIMEOUT_MS}ms`,
          ),
        ),
    });

    const total = WARMUP + SAMPLES;
    for (let k = 0; k < total; k++) {
      const ch = ALPHABET.charAt(k % ALPHABET.length);
      // Constructed BEFORE the clock starts: building the call folds and decodes the
      // payload, which is this process's work, not the round-trip's.
      const send = padiCall(dispatch, "lifecycle/sendInput", { id, data: ch });
      const echoed = reader.expect(ch);
      const t0 = process.hrtime.bigint();
      yield* send;
      const t1 = yield* Effect.timeoutOrElse(Deferred.await(echoed), {
        duration: TIMEOUT_MS,
        orElse: () =>
          Effect.fail(
            new Error(
              `no echo of ${JSON.stringify(ch)} within ${TIMEOUT_MS}ms (terminal ${term}, keystroke ${k})`,
            ),
          ),
      });
      if (k >= WARMUP) out.push(Number(t1 - t0) / 1e6);
      // Housekeeping (not measured): erase the char so the readline buffer stays ~1
      // wide and long-line redraws never pollute later samples.
      yield* padiCall(dispatch, "lifecycle/sendInput", { id, data: BACKSPACE });
      if (INTERKEY_MS > 0) yield* Effect.sleep(INTERKEY_MS);
    }
  });
}

/** Create a bare shell, measure it, kill it. Appends to `out`. */
function measureTerminal(
  dispatch: SurfaceDispatch,
  term: number,
  out: number[],
): Effect.Effect<void, unknown> {
  return Effect.gen(function* () {
    // `TOPLEVEL_PLACEMENT`, not `{}`: a create must STATE where the terminal
    // goes, and the bench means a tile of its own — it measures one bare shell
    // at a time with no parent to split. `padiCall` takes its verb as a STRING
    // and its input as `unknown`, so nothing here is typechecked against
    // `PadiCreateInputSchema`; this call would compile exactly as before and
    // die at the wire on the first terminal, before a single sample.
    const { id } = (yield* padiCall(dispatch, "lifecycle/create", {
      placement: TOPLEVEL_PLACEMENT,
    })) as TerminalInfo;
    const reader = new EchoReader();

    // The attach pump and the keystroke loop race. The loop finishing INTERRUPTS the
    // pump, and that interruption IS the unsubscribe (the stream's own finalizers).
    // `raceFirst`, not `race`: the first to SETTLE wins, so a pump that FAILS or ends
    // — a dropped wire, a dead PTY — fails the bench with its own cause instead of
    // leaving the loop to time out and blame a missing echo.
    yield* Effect.raceFirst(
      Effect.andThen(
        Stream.runForEach(
          padiStream(dispatch, "terminalAttach/get", { id }),
          (frame) =>
            Effect.sync(() => reader.observe(frame as TerminalAttachFrame)),
        ),
        Effect.fail(
          new Error(`terminal ${id}: the attach stream ended mid-measurement`),
        ),
      ),
      keystrokes(dispatch, id, reader, term, out),
    );

    yield* padiCall(dispatch, "lifecycle/kill", { id });
    process.stderr.write(
      `terminal ${term + 1}/${TERMINALS}: ${SAMPLES} samples collected\n`,
    );
  });
}

const main = Effect.gen(function* () {
  const dispatch = yield* dialWire(`ws://${HOST}:${PORT}/rpc/ws`);
  yield* waitForPadi(dispatch);
  const samplesMs: number[] = [];
  for (let term = 0; term < TERMINALS; term++) {
    yield* measureTerminal(dispatch, term, samplesMs);
  }
  report(samplesMs);
}).pipe(Effect.scoped);

// ── Stats + reporting ───────────────────────────────────────────────────────
/** Nearest-rank percentile on an ascending-sorted array: the value at rank
 *  ceil(p/100 · n). Deterministic and interpolation-free, so W2.2 compares
 *  like for like. */
function percentile(sortedAsc: number[], p: number): number {
  if (sortedAsc.length === 0) return Number.NaN;
  const rank = Math.ceil((p / 100) * sortedAsc.length);
  return sortedAsc[Math.min(Math.max(rank, 1), sortedAsc.length) - 1] as number;
}

function report(samplesMs: number[]): void {
  if (samplesMs.length === 0) throw new Error("bench collected zero samples");
  const sorted = [...samplesMs].sort((a, b) => a - b);
  const sum = sorted.reduce((a, b) => a + b, 0);
  const round = (n: number) => Math.round(n * 1000) / 1000;
  const result = {
    measurement: "typing-echo-latency",
    unit: "ms",
    clock: {
      start: "lifecycle.sendInput dispatched on kolu-server /rpc/ws",
      stop: "echoed char first seen in padiSurface.terminalAttach delta",
      note: "both clock points on kolu-server's websocket, near side of the hop padi (W2.2) inserts",
    },
    config: {
      host: HOST,
      port: PORT,
      terminals: TERMINALS,
      samplesPerTerminal: SAMPLES,
      warmupPerTerminal: WARMUP,
      interKeyMs: INTERKEY_MS,
    },
    env: {
      node: process.version,
      platform: `${os.type()} ${os.release()} ${os.arch()}`,
      cpuModel: os.cpus()[0]?.model ?? "unknown",
      cpuCount: os.cpus().length,
      hostname: os.hostname(),
    },
    samples: sorted.length,
    ms: {
      min: round(sorted[0] as number),
      p50: round(percentile(sorted, 50)),
      p90: round(percentile(sorted, 90)),
      p95: round(percentile(sorted, 95)),
      p99: round(percentile(sorted, 99)),
      max: round(sorted[sorted.length - 1] as number),
      mean: round(sum / sorted.length),
    },
    rawMs: sorted.map(round),
  };

  const { ms } = result;
  process.stderr.write(
    `\ntyping-echo latency over ${sorted.length} keystrokes (ms):\n` +
      `  p50=${ms.p50}  p90=${ms.p90}  p95=${ms.p95}  p99=${ms.p99}  (min=${ms.min} max=${ms.max} mean=${ms.mean})\n\n`,
  );
  const json = JSON.stringify(result, null, 2);
  if (OUT) {
    fs.writeFileSync(OUT, json);
    process.stderr.write(`wrote ${OUT}\n`);
  }
  process.stdout.write(`${json}\n`);
}

// ── Small helpers ────────────────────────────────────────────────────────────
function envInt(name: string, fallback: number): number {
  const raw = process.env[name];
  if (raw === undefined || raw === "") return fallback;
  const n = Number.parseInt(raw, 10);
  if (!Number.isFinite(n))
    throw new Error(`${name} must be an integer, got ${raw}`);
  return n;
}

function requireEnvInt(name: string): number {
  const raw = process.env[name];
  if (raw === undefined || raw === "") throw new Error(`${name} is required`);
  const n = Number.parseInt(raw, 10);
  if (!Number.isFinite(n))
    throw new Error(`${name} must be an integer, got ${raw}`);
  return n;
}

// THE process edge — everything above is a description, and this is the one line
// that makes it happen. It runs the EXIT rather than the value so a failure prints
// its CAUSE (which carries the wire's own failure, not a flattened string) and
// exits non-zero for `run.sh`.
const exit = await Effect.runPromiseExit(main);
if (Exit.isFailure(exit)) {
  process.stderr.write(`${Cause.pretty(exit.cause)}\n`);
  process.exit(1);
}
