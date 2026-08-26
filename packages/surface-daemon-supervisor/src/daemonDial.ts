/**
 * **The supervisor's DIAL LEAF** — the socket dial, the contract-skew signal,
 * and the shape a handshaken connection has. Nothing else.
 *
 * It exists because of who else needs these three. `@kolu/padi-client/dial`
 * (`connectPadi`) needs exactly `dialSocket` + `DaemonContractSkewError` +
 * `DaemonConnection` and nothing more — and it is the entry an OUT-OF-REPO
 * consumer hydrates on its own (juspay/kolu#2216), so what it reaches, that
 * consumer's `tsc` compiles. Reaching them through this package's BARREL made
 * it compile `endpoint.ts`: the drivers, the convergence probe, the osfacts
 * process-identity client — and through that last one, an `osfacts-client`
 * graft the consumer had to pin, guard with a check script, and carry a
 * `.d.ts` for a call none of its own source makes. `@kolu/padi-client`'s
 * hydrate guard recorded that barrel as a KNOWN cost with the fix named:
 * "closing this needs leaf entries on those packages". This is that leaf.
 *
 * The three belong together and belong at the bottom: a dial produces a
 * connection or raises skew, and none of the three knows anything about
 * supervision. `endpoint.ts` imports them from here and re-exports them, so the
 * barrel's surface is unchanged and every in-repo caller keeps its import.
 *
 * Its whole compile cost is `node:net` and `effect`.
 */

export { dialSocket } from "./dialSocket.ts";

/** `metadata` is present exactly when the endpoint declares a metadata type —
 *  absent (and typed absent) when it does not, so a metadata-less endpoint
 *  cannot carry a stray field and a metadata-bearing one cannot omit it. */
export type ConnectedMetadata<M> = [M] extends [undefined]
  ? { metadata?: undefined }
  : { metadata: M };

/** A live, handshaken connection to a daemon. The injected `connect` builds it;
 *  the endpoint holds it and tears it down. */
export type DaemonConnection<C, I, M = undefined> = {
  client: C;
  identity: I;
  startedAt: number;
  /** Drop the transport. */
  dispose(): void;
  /** Subscribe to the transport dropping (the daemon exited / the socket
   *  closed). Fires at most once. The endpoint uses it to flip to `degraded`. */
  onClose(cb: () => void): void;
} & ConnectedMetadata<M>;

/**
 * The soul's `connect` throws THIS — and only this — to tell the endpoint a live
 * survivor is genuinely INCOMPATIBLE (a contract-version skew: the daemon speaks
 * a version this client cannot talk to). It is the one connect failure that
 * proves recycling is safe-and-necessary: retrying can never make an
 * incompatible daemon compatible, and the survivor must be replaced.
 *
 * The endpoint stays soul-agnostic about *what* skew means — it never parses an
 * error message or knows a contract version. It only checks this typed marker:
 * the soul (which owns the handshake) decides "this is skew" and signals it.
 * Every OTHER connect rejection (a transport dial failure, an unreadable
 * handshake read) is NON-skew — possibly transient — so `adoptOrEnsure` retries
 * it and, if it persists, refuses to kill the live survivor (F4): a daemon we
 * merely cannot reach right now is not proven incompatible, and killing it would
 * destroy the live PTYs adoption exists to preserve.
 */
export class DaemonContractSkewError extends Error {
  readonly isContractSkew = true as const;
  /** Which contract flavor skewed ("pty-host", "padiSurface") — a readable
   *  FIELD, so a consumer that logs or routes by flavor never parses prose. */
  readonly subject: string;
  /** The contract version the running daemon actually speaks. */
  readonly daemonVersion: string;
  /** The contract version this supervisor's build requires. */
  readonly requiredVersion: string;
  /** The skewed daemon's own OS pid, as it self-reported over the handshake
   *  (kaval's `system.version.pid`). ADDITIVE and optional. It rides HERE — not
   *  only on a `DaemonConnection` — because the skew path THROWS before a
   *  connection is ever built, and the gate-less-squatter recovery of an OLD,
   *  skewed orphan (the 25494 case) still needs the daemon's self-reported pid as
   *  its third identity attestation. */
  readonly pid?: number;
  /** The message is DERIVED from the fields (parse-don't-validate — no
   *  consumer ever regexes the prose back apart); `subject` names the
   *  contract's flavor for a legible journal line ("pty-host", "padiSurface")
   *  while staying a field, never free prose. */
  constructor(versions: {
    subject: string;
    daemonVersion: string;
    requiredVersion: string;
    /** The skewed daemon's self-reported OS pid, if the handshake carried one. */
    pid?: number;
  }) {
    super(
      `${versions.subject} contract skew: daemon speaks ${versions.daemonVersion}, needs ${versions.requiredVersion}`,
    );
    this.name = "DaemonContractSkewError";
    this.subject = versions.subject;
    this.daemonVersion = versions.daemonVersion;
    this.requiredVersion = versions.requiredVersion;
    this.pid = versions.pid;
  }
}

/** True iff `err` is a `DaemonContractSkewError` — a genuine contract skew the
 *  soul's `connect` raised. Brand-checked (not `instanceof`) so it holds across
 *  module-instance / realm boundaries, the same robustness oRPC errors use. */
export function isContractSkewError(
  err: unknown,
): err is DaemonContractSkewError {
  const e = err as {
    isContractSkew?: unknown;
    subject?: unknown;
    daemonVersion?: unknown;
    requiredVersion?: unknown;
  };
  return (
    typeof err === "object" &&
    err !== null &&
    e.isContractSkew === true &&
    // The narrowed type promises its FIELDS (`subject` for the flavor a
    // consumer logs/routes by; the versions for the incompatible status arm
    // and the typed rethrow) — so the brand attests them all: a foreign
    // brand-carrier without the payload must not narrow to a type whose
    // fields it cannot honor.
    typeof e.subject === "string" &&
    typeof e.daemonVersion === "string" &&
    typeof e.requiredVersion === "string"
  );
}
