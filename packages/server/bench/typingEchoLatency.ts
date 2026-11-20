import fs from "node:fs";
import os from "node:os";
import type { TerminalAttachFrame } from "@kolu/padi/endpoint";
import type { SurfaceDispatch } from "@kolu/surface/link";
import type { Surface, WireSchema } from "@kolu/surface/define";
import { TOPLEVEL_PLACEMENT } from "@kolu/padi-client/surface";
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
import type { Rpc } from "effect/rpc";
import { encodeHostKey, LOCAL_HOST } from "kolu-common/hostKey";
import { padiHostMap } from "kolu-common/surfacesWithPadi";

const HOST = process.env.KOLU_BENCH_HOST ?? "127.0.0.1";
const PORT = requireEnvInt("KOLU_BENCH_PORT");
const TERMINALS = envInt("KOLU_BENCH_TERMINALS", 5);
const SAMPLES = envInt("KOLU_BENCH_SAMPLES", 250);
const WARMUP = envInt("KOLU_BENCH_WARMUP", 50);
const TIMEOUT_MS = envInt("KOLU_BENCH_TIMEOUT_MS", 5000);
const INTERKEY_MS = envInt("KOLU_BENCH_INTERKEY_MS", 2);
const OUT = process.env.KOLU_BENCH_OUT;

const PADI_READY_TIMEOUT_MS = 60_000;
const PADI_POLL_MS = 250;

const ALPHABET =
  "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789";
const BACKSPACE = "\x7f";

const HOST_KEY = encodeHostKey(LOCAL_HOST);

type PadiEntrySpec =
  (typeof padiHostMap)["entry"] extends Surface<infer S> ? S : never;
type PadiProcedures = NonNullable<PadiEntrySpec["procedures"]>;
type PadiStreams = NonNullable<PadiEntrySpec["streams"]>;

type CallVerb = {
  [N in keyof PadiProcedures & string]: `${N}/${keyof PadiProcedures[N] &
    string}`;
}[keyof PadiProcedures & string];

type StreamVerb = `${keyof PadiStreams & string}/get`;

type CallSpec<V extends CallVerb> = {
  [N in keyof PadiProcedures & string]: {
    [M in keyof PadiProcedures[N] & string]: V extends `${N}/${M}`
      ? PadiProcedures[N][M]
      : never;
  }[keyof PadiProcedures[N] & string];
}[keyof PadiProcedures & string];

type StreamSpecOf<V extends StreamVerb> = {
  [K in keyof PadiStreams & string]: V extends `${K}/get`
    ? PadiStreams[K]
    : never;
}[keyof PadiStreams & string];

type CallInput<V extends CallVerb> =
  CallSpec<V> extends {
    input: WireSchema<infer I>;
  }
    ? I
    : undefined;

type CallOutput<V extends CallVerb> =
  CallSpec<V> extends {
    output: WireSchema<infer O>;
  }
    ? O
    : undefined;

type StreamInput<V extends StreamVerb> =
  StreamSpecOf<V> extends {
    inputSchema: WireSchema<infer I>;
  }
    ? I
    : undefined;

type StreamFrame<V extends StreamVerb> =
  StreamSpecOf<V> extends {
    outputSchema: WireSchema<infer T>;
  }
    ? T
    : never;

const padiTag = (memberVerb: CallVerb | StreamVerb): string =>
  `${padiHostMap.tagPrefix}${memberVerb}`;

function padiPayload(
  memberVerb: CallVerb | StreamVerb,
  input?: unknown,
): unknown {
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

const padiCall = <V extends CallVerb>(
  dispatch: SurfaceDispatch,
  memberVerb: V,
  input?: CallInput<V>,
): Effect.Effect<CallOutput<V>, unknown> =>
  dispatch.unary(
    padiTag(memberVerb),
    padiPayload(memberVerb, input),
  ) as Effect.Effect<CallOutput<V>, unknown>;

const padiStream = <V extends StreamVerb>(
  dispatch: SurfaceDispatch,
  memberVerb: V,
  input: StreamInput<V>,
): Stream.Stream<StreamFrame<V>, unknown> =>
  dispatch.stream(
    padiTag(memberVerb),
    padiPayload(memberVerb, input),
  ) as Stream.Stream<StreamFrame<V>, unknown>;

function dialWire(url: string) {
  return Effect.map(
    Effect.acquireRelease(
      Effect.promise(() =>
        websocketLink({
          group: padiHostMap.group,
          url: () => url,
          isTerminalClose: isStaleProcessClose,
        }),
      ),
      (link) => Effect.promise(() => link.dispose()),
    ),
    (link) => link.dispatch,
  );
}

class EchoReader {
  readonly attached = Deferred.makeUnsafe<void>();
  private pending: { ch: string; at: Deferred.Deferred<bigint> } | null = null;

  expect(ch: string): Deferred.Deferred<bigint> {
    const at = Deferred.makeUnsafe<bigint>();
    this.pending = { ch, at };
    return at;
  }

  observe(frame: TerminalAttachFrame): void {
    const at = process.hrtime.bigint();
    if (frame.kind === "snapshot") {
      Deferred.doneUnsafe(this.attached, Effect.void);
      return;
    }
    if (frame.kind !== "delta") return;
    const p = this.pending;
    if (p === null || !frame.data.includes(p.ch)) return;
    this.pending = null;
    Deferred.doneUnsafe(p.at, Effect.succeed(at));
  }
}

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

function keystrokes(
  dispatch: SurfaceDispatch,
  id: string,
  reader: EchoReader,
  term: number,
  out: number[],
): Effect.Effect<void, unknown> {
  return Effect.gen(function* () {
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
      yield* padiCall(dispatch, "lifecycle/sendInput", { id, data: BACKSPACE });
      if (INTERKEY_MS > 0) yield* Effect.sleep(INTERKEY_MS);
    }
  });
}

function measureTerminal(
  dispatch: SurfaceDispatch,
  term: number,
  out: number[],
): Effect.Effect<void, unknown> {
  return Effect.gen(function* () {
    const { id } = yield* padiCall(dispatch, "lifecycle/create", {
      placement: TOPLEVEL_PLACEMENT,
    });
    const reader = new EchoReader();

    yield* Effect.raceFirst(
      Effect.andThen(
        Stream.runForEach(
          padiStream(dispatch, "terminalAttach/get", { id }),
          (frame) => Effect.sync(() => reader.observe(frame)),
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

const exit = await Effect.runPromiseExit(main);
if (Exit.isFailure(exit)) {
  process.stderr.write(`${Cause.pretty(exit.cause)}\n`);
  process.exit(1);
}
