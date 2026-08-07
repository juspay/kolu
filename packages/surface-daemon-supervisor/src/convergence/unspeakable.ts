/**
 * The **unspeakable-protocol** vocabulary — PLAN D6 / review finding #3.
 *
 * The Effect-4 wire break is a declared **protocol epoch** flag day: a daemon
 * from the previous epoch cannot be asked its version, because version
 * negotiation happens *inside* the protocol that was replaced. So a supervisor
 * meeting one observes neither an identity nor an absence nor a generic probe
 * failure — it observes a THIRD, narrowly-typed fact: *something is serving this
 * rendezvous and it does not speak our protocol at all*.
 *
 * ## Two triggers, one fact ({@link UnspeakableEvidence})
 *
 * A cross-epoch peer betrays itself in exactly two ways, and which one you get
 * depends on who greets whom:
 *
 * 1. `undecodable-frame` — the peer speaks FIRST in a framing we cannot parse.
 * 2. `silence` — the peer waits for a greeting in a protocol we do not speak, so
 *    it accepts our connection, takes our frames, and answers nothing at all.
 *    Measured against the real previous release: the old oRPC `ServerPeer` waits
 *    for its own client hello, our ndjson frames never look like one, and the
 *    connection dies by TIMEOUT with no first frame to fail decoding.
 *
 * Both are the SAME verdict — "not of this epoch" — so they are one error type
 * with the evidence as a tagged field, never two error classes a consumer would
 * have to union.
 *
 * ## Two types, because the fact and the VERDICT are not the same thing
 *
 * 1. {@link UnspeakableProtocolError} — the TRANSPORT fact, raised by the dial
 *    path at one of the two triggers above (never by the frozen hello's own
 *    deadline, never by a close, never by a handler error). On its own it is
 *    just a probe failure: a stranger on our socket may babble anything — or
 *    nothing — and this package's oldest rule is that we never act on a process
 *    we have not proven is ours.
 * 2. {@link UnspeakablePeerError} — the CORROBORATED verdict: the same fact,
 *    plus the two attestations D6/#3 requires before convergence may act on it —
 *    **we own the gate file** at this rendezvous, and **we verified the pid** it
 *    names (`liveServingHolder`'s identity law). Only this one becomes a
 *    convergence observation, and it is what buys the TAKEOVER (PLAN D6 /
 *    Wave A): the holder is re-attested, stopped by signal — the in-process
 *    shutdown a drain verb would have requested — and replaced by a daemon of
 *    this epoch, which seeds from disk.
 *
 * The split is the whole safety story, and it is what lets the `silence` trigger
 * exist at all: a merely SLOW peer and a foreign squatter both stop at the
 * transport fact. `probe-failed` is NEVER widened (`bindResult.ts`'s "never
 * catch-to-null" note stays honored), and a foreign socket-squatter — no gate of
 * ours, or a pid we cannot verify — keeps taking the untouched
 * `SocketSquatterForeignError` / probe-failed path, so nothing this file adds
 * can put a SIGTERM near a process we did not prove is our own daemon.
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
 * WHY a peer is unspeakable — evidence as DATA, one arm per trigger, so a
 * consumer that renders or branches on it never parses a sentence.
 *
 * There is no third arm and there must not be: every OTHER way a dial can fail
 * (a close, a member error, a hello that arrives late, bytes that decode into
 * something we did not expect) is an ordinary probe failure. That bounded list
 * is the whole reason `probe-failed` is not widened by this observation.
 */
export type UnspeakableEvidence =
  | {
      readonly trigger: "undecodable-frame";
      /** {@link frameExcerpt} of the bytes that failed to decode. */
      readonly frame: string;
    }
  | {
      readonly trigger: "silence";
      /** The bound the peer stayed mute through, in ms — the explicit deadline
       *  the dial path armed, not a measured duration. */
      readonly silentForMs: number;
    };

/** The one place the two triggers turn into prose, so the dial path, the
 *  corroboration site and the fold cannot drift in what they tell an operator. */
export function unspeakableClause(evidence: UnspeakableEvidence): string {
  return evidence.trigger === "undecodable-frame"
    ? `answered our first frame with ${evidence.frame}, which this protocol epoch cannot decode`
    : `accepted our connection and then said nothing at all for ${evidence.silentForMs}ms — ` +
        "longer than a daemon of this epoch can stay silent, which is what a peer waiting for " +
        "a greeting in a protocol we no longer speak looks like";
}

/** True for a well-formed {@link UnspeakableEvidence} — every field the narrowed
 *  arm promises is attested, so a bare tag-carrier cannot narrow to a type whose
 *  fields a consumer would then dereference. */
function isUnspeakableEvidence(value: unknown): value is UnspeakableEvidence {
  if (typeof value !== "object" || value === null) return false;
  const e = value as {
    trigger?: unknown;
    frame?: unknown;
    silentForMs?: unknown;
  };
  if (e.trigger === "undecodable-frame") return typeof e.frame === "string";
  if (e.trigger === "silence") {
    return typeof e.silentForMs === "number" && Number.isFinite(e.silentForMs);
  }
  return false;
}

/**
 * The peer at `socketPath` is not of this protocol epoch — raised ONLY at one of
 * {@link UnspeakableEvidence}'s two triggers, never by the frozen hello's
 * deadline, a close, or a member error.
 *
 * This is a TRANSPORT fact, not a convergence verdict: uncorroborated, it is
 * reported as an ordinary probe failure. See {@link UnspeakablePeerError}.
 */
export class UnspeakableProtocolError extends Error {
  readonly isUnspeakableProtocol = true as const;
  /** The rendezvous socket whose peer proved unspeakable. */
  readonly socketPath: string;
  /** WHICH trigger fired, with its own evidence — as a FIELD, so a consumer that
   *  logs or renders it never re-parses the message. */
  readonly evidence: UnspeakableEvidence;
  constructor(args: {
    socketPath: string;
    evidence: UnspeakableEvidence;
    cause?: unknown;
    /** Overrides the derived message — used by the corroborated subclass. */
    message?: string;
  }) {
    super(
      args.message ??
        `the peer serving ${args.socketPath} ${unspeakableClause(args.evidence)}`,
      { cause: args.cause },
    );
    this.name = "UnspeakableProtocolError";
    this.socketPath = args.socketPath;
    this.evidence = args.evidence;
  }
}

/** True iff `err` is an {@link UnspeakableProtocolError}. Brand-checked (not
 *  `instanceof`) so it narrows across module-instance / realm boundaries, like
 *  every other typed refusal in this package — and it attests EVERY field the
 *  narrowed type promises. */
export function isUnspeakableProtocolError(
  err: unknown,
): err is UnspeakableProtocolError {
  if (typeof err !== "object" || err === null) return false;
  const e = err as { isUnspeakableProtocol?: unknown; socketPath?: unknown };
  return (
    e.isUnspeakableProtocol === true &&
    typeof e.socketPath === "string" &&
    isUnspeakableEvidence((e as { evidence?: unknown }).evidence)
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
    evidence: UnspeakableEvidence;
    cause?: unknown;
  }) {
    super({
      socketPath: args.socketPath,
      evidence: args.evidence,
      cause: args.cause,
      message:
        `the daemon serving ${args.socketPath} (pid ${args.pid}, named by our gate ${args.gatePath}) ` +
        `${unspeakableClause(args.evidence)} — it speaks a protocol epoch this supervisor cannot decode`,
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
