/**
 * The **unspeakable-protocol** vocabulary — PLAN D6 / review finding #3.
 *
 * The Effect-4 wire break is a declared **protocol epoch** flag day: a daemon
 * from the previous epoch cannot be asked its version, because version
 * negotiation happens *inside* the protocol that was replaced. Its very first
 * frame is undecodable. So a supervisor meeting one observes neither an
 * identity nor an absence nor a generic probe failure — it observes a THIRD,
 * narrowly-typed fact: *something is serving this rendezvous and it does not
 * speak our protocol at all*.
 *
 * Two types, because the fact and the VERDICT are not the same thing:
 *
 * 1. {@link UnspeakableProtocolError} — the TRANSPORT fact, raised by the dial
 *    path the instant a peer's first frame fails to decode (never by a timeout,
 *    never by a close, never by a handler error). On its own it is just a probe
 *    failure: a stranger on our socket may babble anything, and this package's
 *    oldest rule is that we never act on a process we have not proven is ours.
 * 2. {@link UnspeakablePeerError} — the CORROBORATED verdict: the same fact,
 *    plus the two attestations D6/#3 requires before convergence may act on it —
 *    **we own the gate file** at this rendezvous, and **we verified the pid** it
 *    names (`liveServingHolder`'s identity law). Only this one becomes a
 *    convergence observation.
 *
 * The split is the whole safety story. `probe-failed` is NEVER widened
 * (`bindResult.ts`'s "never catch-to-null" note stays honored), and a foreign
 * socket-squatter — no gate of ours, or a pid we cannot verify — keeps taking
 * the untouched `SocketSquatterForeignError` / probe-failed path, so nothing
 * this file adds can put a SIGTERM near a process we did not prove is our own
 * daemon.
 *
 * Zero imports: this leaf is shared by the dial path (`probeDaemonIdentity`),
 * the corroboration site (`endpoint.ts`) and the fold (`converge.ts`), and must
 * not create an edge between them.
 */

/** How much of an undecodable first frame the error quotes. Bounded: the bytes
 *  come from an unknown peer and land in operator-facing logs. */
const FRAME_EXCERPT_LIMIT = 120;

/** A bounded, control-byte-safe rendering of the bytes that failed to decode —
 *  JSON-quoted, so a peer that sends newlines, NULs or ANSI cannot reshape the
 *  log line it lands in. */
export function frameExcerpt(bytes: Uint8Array | string): string {
  const text =
    typeof bytes === "string" ? bytes : new TextDecoder().decode(bytes);
  const clipped =
    text.length > FRAME_EXCERPT_LIMIT
      ? `${text.slice(0, FRAME_EXCERPT_LIMIT)}…`
      : text;
  return JSON.stringify(clipped);
}

/**
 * The peer at `socketPath` answered with bytes this protocol epoch cannot
 * decode — raised ONLY at an explicit first-frame decode failure, never by a
 * hello deadline, a close, or a member error.
 *
 * This is a TRANSPORT fact, not a convergence verdict: uncorroborated, it is
 * reported as an ordinary probe failure. See {@link UnspeakablePeerError}.
 */
export class UnspeakableProtocolError extends Error {
  readonly isUnspeakableProtocol = true as const;
  /** The rendezvous socket whose peer spoke the undecodable frame. */
  readonly socketPath: string;
  /** {@link frameExcerpt} of the bytes that failed to decode — evidence as a
   *  FIELD, so a consumer that logs or renders it never re-parses the message. */
  readonly frame: string;
  constructor(args: {
    socketPath: string;
    frame: string;
    cause?: unknown;
    /** Overrides the derived message — used by the corroborated subclass. */
    message?: string;
  }) {
    super(
      args.message ??
        `the peer serving ${args.socketPath} answered our first frame with ${args.frame}, ` +
          "which this protocol epoch cannot decode",
      { cause: args.cause },
    );
    this.name = "UnspeakableProtocolError";
    this.socketPath = args.socketPath;
    this.frame = args.frame;
  }
}

/** True iff `err` is an {@link UnspeakableProtocolError}. Brand-checked (not
 *  `instanceof`) so it narrows across module-instance / realm boundaries, like
 *  every other typed refusal in this package — and it attests EVERY field the
 *  narrowed type promises, so a bare brand-carrier cannot narrow to a type whose
 *  fields a consumer would then dereference. */
export function isUnspeakableProtocolError(
  err: unknown,
): err is UnspeakableProtocolError {
  if (typeof err !== "object" || err === null) return false;
  const e = err as {
    isUnspeakableProtocol?: unknown;
    socketPath?: unknown;
    frame?: unknown;
  };
  return (
    e.isUnspeakableProtocol === true &&
    typeof e.socketPath === "string" &&
    typeof e.frame === "string"
  );
}

/**
 * An {@link UnspeakableProtocolError} we have CORROBORATED against our own
 * rendezvous: the gate file at `gatePath` is ours, and `pid` is the holder it
 * names, verified by the endpoint's identity law (two-field ±2 s match, or the
 * legacy one-field liveness + a serving socket).
 *
 * This — and only this — is what `converge` folds into the `unspeakable-protocol`
 * observation and what a policy may act on.
 */
export class UnspeakablePeerError extends UnspeakableProtocolError {
  readonly isUnspeakablePeer = true as const;
  /** The gate file that named the holder — ours, at this rendezvous. */
  readonly gatePath: string;
  /** The holder pid, verified before this error was minted. */
  readonly pid: number;
  constructor(args: {
    socketPath: string;
    gatePath: string;
    pid: number;
    frame: string;
    cause?: unknown;
  }) {
    super({
      socketPath: args.socketPath,
      frame: args.frame,
      cause: args.cause,
      message:
        `the daemon serving ${args.socketPath} (pid ${args.pid}, named by our gate ${args.gatePath}) ` +
        `answered our first frame with ${args.frame} — it speaks a protocol epoch this supervisor cannot decode`,
    });
    this.name = "UnspeakablePeerError";
    this.gatePath = args.gatePath;
    this.pid = args.pid;
  }
}

/** True iff `err` is a CORROBORATED {@link UnspeakablePeerError} — brand-checked
 *  and attesting the two extra attestations its type promises. */
export function isUnspeakablePeerError(
  err: unknown,
): err is UnspeakablePeerError {
  if (!isUnspeakableProtocolError(err)) return false;
  const e = err as {
    isUnspeakablePeer?: unknown;
    gatePath?: unknown;
    pid?: unknown;
  };
  return (
    e.isUnspeakablePeer === true &&
    typeof e.gatePath === "string" &&
    typeof e.pid === "number" &&
    Number.isInteger(e.pid) &&
    e.pid > 0
  );
}
