/**
 * The **stdio readiness gate** — the one thing a stdio SERVER must say before a
 * client may attach an RPC protocol (and therefore a pinger) to it.
 *
 * ## Why a gate exists at all
 *
 * The stdio leg is the only leg that crosses a **protocol epoch** boundary. A
 * unix-socket rendezvous is local: whoever dials it has already run the
 * supervisor's converge-before-dial discipline (gate file, pid table, signals
 * all reachable). The stdio leg does not have that luxury — `ssh <host> padi
 * --stdio` reaches a box whose daemon may predate this wire epoch entirely, and
 * a previous-epoch peer **accepts the splice and then says nothing**, because it
 * is waiting for a greeting in a protocol we no longer speak.
 *
 * Attaching an `RpcClient` to that peer is not merely useless, it is actively
 * harmful: Effect RPC's protocol socket starts a pinger the moment it is built,
 * the pinger kills the link after two unanswered pings, and the death arrives as
 * an ordinary transport error indistinguishable from an unreachable host. That
 * is the juspay/kolu#2101 production incident — every remote host wedged in a
 * permanent connect loop, because "the peer is from another epoch" was reported
 * as "the network is flaky", which retries forever by design.
 *
 * **The invariant this module exists to make structural: no pinger before a
 * proven epoch.** {@link stdioLink} requires a {@link StdioReadinessProof}, the
 * proof is minted ONLY by {@link awaitStdioReadiness}, and
 * {@link awaitStdioReadiness} mints it only after reading a well-formed `ready`
 * banner off the peer's own stream. A blind attach is therefore not a discipline
 * anyone has to remember — it does not typecheck, and a forged look-alike does
 * not construct (see {@link READINESS_PROOFS}).
 *
 * ## The wire form
 *
 * Exactly ONE newline-terminated JSON line, written on the server's stdout
 * BEFORE its first RPC frame:
 *
 * ```
 * {"surfaceStdioGate":{"v":1,"verdict":"ready"}}
 * {"surfaceStdioGate":{"v":1,"verdict":"refused","detail":"…","anomaly":<json|null>}}
 * ```
 *
 * `surfaceStdioGate` is a reserved discriminating key: an RPC frame is a tagged
 * protocol message and never carries it, so the banner cannot be confused with
 * traffic in either direction. `anomaly` is **opaque to the framework** — the
 * app layer that writes it owns its shape (kolu's padi front encodes a
 * `PadiConvergence`; kolu-server decodes it with the matching schema). This
 * module must never learn supervisor vocabulary; that is the layering rule that
 * keeps `@kolu/surface` free of `@kolu/surface-daemon-supervisor`.
 *
 * ## No version bump rides with this
 *
 * The banner is NOT a compatibility-negotiated feature and gets no
 * `PADI_SURFACE_VERSION` / `PTY_HOST_CONTRACT_VERSION` bump. This PR *is* the
 * (unreleased) Effect-4 wire epoch — the declared flag day — so the banner ships
 * inside the same break rather than alongside it. A peer that does not greet is,
 * by definition, from before the flag day, which is exactly the fact the gate is
 * built to observe. There is deliberately no "greet optional" mode: an
 * ungreeted peer is a classified failure, never a silent degradation.
 *
 * ## Compatibility with the byte-splice guarantee
 *
 * `links/byteSplice.test.ts` pins the bytes of the SPLICED FRAMES — the request
 * and response traffic — and the banner is not one: it is written by whoever
 * owns stdout *before* the relay begins, and consumed off the stream before the
 * protocol layer is built. `serveOverStdio` greets only when the process IS the
 * agent (the same construction-time discriminant that decides who owns stdout);
 * a daemon front greets after its own converge, then splices.
 */

import type { Readable, Writable } from "node:stream";

/** The reserved top-level key that discriminates a gate banner from an RPC
 *  frame. Reserved by fiat and by shape: RPC frames are tagged protocol
 *  messages, and nothing in the surface tag algebra can mint this name. */
export const STDIO_READINESS_KEY = "surfaceStdioGate";

/** The banner's own version. Bumped only if the BANNER's shape changes — not
 *  when a surface contract does. `v: 1` ships with the wire epoch this PR
 *  declares; there is no `v: 0` to be compatible with. */
export const STDIO_READINESS_VERSION = 1;

/** How much of an unrecognisable prelude the failure quotes. Bounded: the bytes
 *  come from an unknown peer and land in operator-facing logs. Mirrors the
 *  supervisor's `frameExcerpt` discipline — deliberately re-stated here rather
 *  than imported, because `@kolu/surface` may not depend on the supervisor. */
const PRELUDE_EXCERPT_LIMIT = 120;

/** The most bytes {@link awaitStdioReadiness} will buffer while looking for the
 *  banner's terminating newline. A peer that streams megabytes without ever
 *  ending a line is not a peer of this epoch; failing at a bound beats growing a
 *  buffer until the process dies. Generous enough that no honest banner (a
 *  two-field JSON object plus an app anomaly) can approach it. */
const MAX_PRELUDE_BYTES = 64 * 1024;

/** A bounded, control-byte-safe rendering of bytes that were not a banner —
 *  JSON-quoted, so a peer that sends newlines, NULs or ANSI cannot reshape the
 *  log line it lands in. */
function preludeExcerpt(bytes: Uint8Array | string): string {
  const text =
    typeof bytes === "string" ? bytes : new TextDecoder().decode(bytes);
  const clipped =
    text.length > PRELUDE_EXCERPT_LIMIT
      ? `${text.slice(0, PRELUDE_EXCERPT_LIMIT)}…`
      : text;
  return JSON.stringify(clipped);
}

/** What a stdio server declares about itself before serving frames.
 *
 *  A CLOSED union with the evidence as data: "ready with an error detail" and
 *  "refused with nothing to say" are both unrepresentable. `anomaly` is the
 *  app's typed verdict, carried opaquely — the framework neither reads nor
 *  validates it, it only moves it across the pipe intact. */
export type StdioReadinessVerdict =
  | { readonly verdict: "ready" }
  | {
      readonly verdict: "refused";
      /** One operator-facing sentence. Human garnish — never parsed. */
      readonly detail: string;
      /** The app's typed verdict, JSON-encodable, opaque here. `null` when the
       *  refusing side has no structured evidence to hand over. */
      readonly anomaly: unknown;
    };

/** The brand membership set for {@link StdioReadinessProof}s. Module-private and
 *  **un-reflectable**: a `WeakSet` exposes no enumeration, so a consumer holding
 *  a genuine proof cannot read the brand off it and stamp a hand-rolled
 *  look-alike. The only way into this set is {@link awaitStdioReadiness}, which
 *  adds the proof it returns AFTER it has read a well-formed `ready` banner off
 *  the very stream the proof names.
 *
 *  This is the same mechanism `solid/liveSignal.ts` uses to make an unwatched
 *  dispatch unspellable, applied to the epoch question: the brand and its sole
 *  minter share one module, which is what makes the stamp un-namable from
 *  anywhere else. */
const READINESS_PROOFS = new WeakSet<object>();

/** Evidence that the peer on a stream greeted us with a `ready` banner of THIS
 *  protocol epoch — the token {@link stdioLink} demands before it will build a
 *  protocol layer (and therefore a pinger) over that stream.
 *
 *  It carries only `describe`, and that is the point: there is nothing useful to
 *  read off it, so it cannot be mistaken for a value a caller might reconstruct.
 *  Its whole meaning is membership in {@link READINESS_PROOFS}. */
export interface StdioReadinessProof {
  /** How the greeted transport was described at the wait — carried so a link's
   *  error vocabulary can name the same thing the gate named. */
  readonly describe: string;
}

/** True if `value` is a {@link StdioReadinessProof} minted by
 *  {@link awaitStdioReadiness} — i.e. a `ready` banner was actually read off a
 *  stream. Read-only: checking membership can never add to the WeakSet. */
export function isStdioReadinessProof(
  value: unknown,
): value is StdioReadinessProof {
  return (
    typeof value === "object" && value !== null && READINESS_PROOFS.has(value)
  );
}

/** WHY a readiness wait did not produce a proof — a CLOSED union of the four
 *  ways a peer can fail to greet, each one a *classified* fact a caller can
 *  route on without parsing a sentence:
 *
 *  - `refused`    — the peer greeted and said NO. It is of this epoch and it is
 *                    telling us, in its own words, why it will not serve. Carries
 *                    the app's opaque `anomaly`.
 *  - `undecodable` — the first line was not a banner at all. Either a peer from
 *                    another epoch that speaks first, or something else entirely
 *                    on the pipe. Carries a bounded excerpt as evidence.
 *  - `silent`     — nothing arrived before the deadline. The previous-epoch
 *                    presentation: the peer accepted the pipe and waited for a
 *                    greeting in a protocol we no longer speak.
 *  - `closed`     — the stream ended (or errored) before a full line arrived.
 */
export type StdioReadinessFailureKind =
  | "refused"
  | "undecodable"
  | "silent"
  | "closed";

/** The typed rejection of {@link awaitStdioReadiness}. One error class with the
 *  reason as a FIELD rather than four classes a consumer would have to union —
 *  the same shape the supervisor's `UnspeakableProtocolError` takes, for the
 *  same reason. */
export class StdioReadinessError extends Error {
  readonly isStdioReadinessFailure = true as const;
  /** WHICH way the greeting failed. Branch on this, never on `message`. */
  readonly kind: StdioReadinessFailureKind;
  /** The app's opaque typed verdict when the peer REFUSED; `null` otherwise
   *  (a silent or undecodable peer, by construction, handed us nothing). */
  readonly anomaly: unknown;
  constructor(args: {
    kind: StdioReadinessFailureKind;
    message: string;
    anomaly?: unknown;
  }) {
    super(args.message);
    this.name = "StdioReadinessError";
    this.kind = args.kind;
    this.anomaly = args.anomaly ?? null;
  }
}

/** True for a {@link StdioReadinessError} — structural, so a consumer across a
 *  package boundary (or a duplicated module instance) narrows on the field
 *  rather than on `instanceof`. */
export function isStdioReadinessError(
  value: unknown,
): value is StdioReadinessError {
  return (
    value instanceof Error &&
    (value as StdioReadinessError).isStdioReadinessFailure === true
  );
}

/** Render a verdict as the ONE banner line — the single place the wire form is
 *  spelled, so the writer below and the decoder above cannot drift. */
function encodeStdioReadiness(verdict: StdioReadinessVerdict): string {
  return `${JSON.stringify({
    [STDIO_READINESS_KEY]:
      verdict.verdict === "ready"
        ? { v: STDIO_READINESS_VERSION, verdict: "ready" }
        : {
            v: STDIO_READINESS_VERSION,
            verdict: "refused",
            detail: verdict.detail,
            anomaly: verdict.anomaly ?? null,
          },
  })}\n`;
}

/**
 * Write the readiness banner — the FIRST thing a stdio server puts on the wire.
 *
 * Synchronous by contract: it must land before any frame, and every caller is at
 * a point where it owns stdout exclusively (a `serveOverStdio` boot, a daemon
 * front that has finished converging and has not yet spliced). `Writable.write`
 * buffers rather than blocking, so ordering — not flushing — is what matters,
 * and ordering is guaranteed by writing first.
 *
 * A REFUSED banner is a complete statement: the writer is expected to then exit
 * non-zero without serving. Writing `refused` and serving anyway would hand the
 * client a proof-less link, which is exactly the state this module abolishes.
 */
export function writeStdioReadiness(
  write: Writable,
  verdict: StdioReadinessVerdict,
): void {
  write.write(encodeStdioReadiness(verdict));
}

/** Decode one banner line. Returns the verdict, or `null` when the line is not a
 *  gate banner at all (which the caller reports as `undecodable`, with the raw
 *  bytes as evidence — a decode that "succeeded into something unexpected" is
 *  not a banner either). */
function decodeStdioReadiness(line: string): StdioReadinessVerdict | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(line);
  } catch {
    return null;
  }
  if (typeof parsed !== "object" || parsed === null) return null;
  const banner = (parsed as Record<string, unknown>)[STDIO_READINESS_KEY];
  if (typeof banner !== "object" || banner === null) return null;
  const body = banner as {
    v?: unknown;
    verdict?: unknown;
    detail?: unknown;
    anomaly?: unknown;
  };
  // A banner from a DIFFERENT banner version is not a banner we can act on. It
  // is reported as undecodable rather than "compatible enough" — the whole point
  // of the gate is that we never guess about a peer's epoch.
  if (body.v !== STDIO_READINESS_VERSION) return null;
  if (body.verdict === "ready") return { verdict: "ready" };
  if (body.verdict === "refused" && typeof body.detail === "string") {
    return {
      verdict: "refused",
      detail: body.detail,
      anomaly: body.anomaly ?? null,
    };
  }
  return null;
}

export interface AwaitStdioReadinessOptions {
  /** The stream the peer's banner arrives on — a child's `stdout`, or the read
   *  half of a loopback pair. */
  readonly read: Readable;
  /** Bound on the wait, in ms. REQUIRED, no default: every caller must state a
   *  budget derived from its own ceilings, because expiry is a terminal verdict
   *  and a number nobody chose is not a budget. */
  readonly deadlineMs: number;
  /** How to name the transport in a failure message — what an operator reads. */
  readonly describe: string;
}

/**
 * Read the peer's readiness banner off `read` and mint the proof
 * {@link stdioLink} demands.
 *
 * ## Byte-exact over-read discipline (the load-bearing part)
 *
 * The banner and the peer's first RPC frame can — and in practice do — arrive in
 * ONE chunk. So this consumes exactly up to and including the first `\n` and
 * **unshifts every remaining byte back onto the stream** before resolving. The
 * protocol layer built afterwards therefore sees a stream positioned exactly
 * where the banner ended, with not one frame byte lost.
 *
 * It reads in **paused** mode (`"readable"` + `read()`), never flowing mode, for
 * the same reason: a `"data"` listener puts the stream in flowing mode, and
 * bytes that flow past between the resolve and the next consumer attaching are
 * gone. Node's documented hand-off pattern is precisely this one.
 *
 * ## Failure is classified, never swallowed
 *
 * Every non-`ready` outcome REJECTS with a typed {@link StdioReadinessError}. A
 * caught readiness failure must reach the caller as itself — there is no
 * "assume ready and hope" path, because that path is the incident.
 */
export function awaitStdioReadiness(
  opts: AwaitStdioReadinessOptions,
): Promise<StdioReadinessProof> {
  const { read, deadlineMs, describe } = opts;
  return new Promise<StdioReadinessProof>((resolve, reject) => {
    // Accumulated prelude bytes. Buffers, not a string: the split point is a
    // BYTE offset, and decoding a partial chunk could split a multi-byte UTF-8
    // sequence and corrupt the excerpt an operator reads.
    let buffered: Buffer = Buffer.alloc(0);
    let settled = false;

    const timer = setTimeout(() => {
      fail(
        new StdioReadinessError({
          kind: "silent",
          message:
            `${describe}: the peer accepted the pipe and sent no readiness banner within ${deadlineMs}ms — ` +
            "a daemon of this protocol epoch greets before its first frame, so this peer is either from " +
            "a previous epoch (waiting for a greeting we no longer speak) or wedged",
        }),
      );
    }, deadlineMs);
    // A readiness wait must never be the reason a process stays alive; the
    // caller's own lifetime decides that.
    timer.unref();

    const detach = (): void => {
      clearTimeout(timer);
      read.removeListener("readable", onReadable);
      read.removeListener("end", onEnd);
      read.removeListener("error", onError);
    };

    const fail = (err: StdioReadinessError): void => {
      if (settled) return;
      settled = true;
      detach();
      reject(err);
    };

    const succeed = (): void => {
      // The brand is added LAST — after the banner has been read, decoded and
      // found to say `ready` — so a proof can never exist for a peer that has
      // not actually greeted.
      const proof: StdioReadinessProof = { describe };
      READINESS_PROOFS.add(proof);
      resolve(proof);
    };

    /** The line is in hand; classify it and settle. */
    const decide = (line: Buffer): void => {
      const verdict = decodeStdioReadiness(line.toString("utf-8"));
      if (verdict === null) {
        fail(
          new StdioReadinessError({
            kind: "undecodable",
            message:
              `${describe}: the peer's first line was not a readiness banner of this protocol epoch — ` +
              `it sent ${preludeExcerpt(line)}`,
          }),
        );
        return;
      }
      if (verdict.verdict === "refused") {
        fail(
          new StdioReadinessError({
            kind: "refused",
            message: `${describe}: the peer refused to serve — ${verdict.detail}`,
            anomaly: verdict.anomaly,
          }),
        );
        return;
      }
      settled = true;
      detach();
      succeed();
    };

    const onReadable = (): void => {
      for (;;) {
        if (settled) return;
        const chunk: unknown = read.read();
        if (chunk === null) return;
        // A stream with an encoding set yields strings. Normalise to bytes for
        // the newline scan; the unshift below hands bytes back, which Node
        // re-decodes for a string-mode consumer.
        buffered = Buffer.concat([
          buffered,
          typeof chunk === "string"
            ? Buffer.from(chunk, "utf-8")
            : (chunk as Buffer),
        ]);
        const newline = buffered.indexOf(0x0a);
        if (newline === -1) {
          if (buffered.length > MAX_PRELUDE_BYTES) {
            fail(
              new StdioReadinessError({
                kind: "undecodable",
                message:
                  `${describe}: the peer sent ${buffered.length} bytes with no line break, so no readiness ` +
                  `banner can be read — it began with ${preludeExcerpt(buffered.subarray(0, PRELUDE_EXCERPT_LIMIT))}`,
              }),
            );
            return;
          }
          continue;
        }
        const line = buffered.subarray(0, newline);
        const rest = buffered.subarray(newline + 1);
        // Detach FIRST, then give the over-read back. Order matters: unshifting
        // while still subscribed would re-enter `onReadable` with the bytes we
        // just handed back.
        detach();
        if (rest.length > 0) read.unshift(rest);
        decide(line);
        return;
      }
    };

    const onEnd = (): void => {
      fail(
        new StdioReadinessError({
          kind: "closed",
          message:
            `${describe}: the stream ended before a readiness banner arrived` +
            (buffered.length > 0
              ? ` — it sent ${preludeExcerpt(buffered)} and stopped`
              : " (no bytes at all)"),
        }),
      );
    };

    const onError = (cause: Error): void => {
      fail(
        new StdioReadinessError({
          kind: "closed",
          message: `${describe}: the stream failed before a readiness banner arrived (${cause.message})`,
        }),
      );
    };

    read.on("readable", onReadable);
    read.once("end", onEnd);
    read.once("error", onError);
    // Bytes may already be buffered (a fast child that greeted before we
    // subscribed); `"readable"` is emitted for a stream that already has data,
    // but only on the next tick, so drain synchronously first.
    onReadable();
  });
}
