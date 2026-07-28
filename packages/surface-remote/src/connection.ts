/**
 * `@kolu/surface-remote/connection` — the BROWSER-SAFE connection-health TYPE and
 * its ONE pure projection.
 *
 * A re-served / mirrored surface (drishti, kolu) needs the browser to see the
 * backend↔remote link's health — provisioning / connecting / connected / disconnected /
 * failed — so a dead mirror renders honestly instead of as a healthy-but-empty
 * surface. That health is `HostSession`'s volatility; this module is its consume-facing
 * TYPE.
 *
 * SR9 — one connection authority. This health is NO LONGER a separate per-host
 * `connection` cell (a second wire channel a browser subscribed independently of the
 * host-map dot — the two could latch out of step, drishti#102). It now rides the map's
 * entry as its FINE `connection` payload, produced by the SAME per-frame projection as
 * the coarse dot (see `serveHostMap`). This module keeps only the browser-safe TYPE +
 * schema + the pure {@link projectConnection} leaf a consumer derives the word from the
 * entry with; the cell, its gate-closed seed, its readiness `liveWhen`, and the
 * `mirroredSurface` seam that composed it are gone. THIS module imports only `zod`,
 * `@kolu/surface-map/evidence` (itself zod-only), and type-only session shapes — so it
 * rides the browser bundle.
 */

// The failure-evidence vocabulary, from `@kolu/surface-map`'s zod-only `./evidence`
// leaf rather than its default entry: the default entry is the CONTRACT half, which
// imports `@orpc/contract` and `@kolu/surface/define` as VALUES, and this module's
// browser-bundle constraint (below) is that it pulls neither.
import {
  type EvidenceLine,
  EvidenceLineSchema,
} from "@kolu/surface-map/evidence";
import { z } from "zod";
// TYPE-ONLY (erased at runtime): the connection value IS `SessionState<SshProv>`, so this
// module keeps ONE connection-state type family. Neither import pulls the node/server
// code those modules carry — `import type` emits nothing.
import type { SessionState } from "./session";
import type { SshProv } from "./sshConnector";

/** One line of the link's provenance-tagged log tail: `source` is WHERE the line came
 *  from (`"local"` = the parent's own provisioning / lifecycle chatter, `"remote"` = the
 *  far agent's forwarded stderr), a FIELD rather than an in-band `[local] `/`[remote] `
 *  string prefix.
 *
 *  It IS `@kolu/surface-map`'s `EvidenceLine` — the same concept, so the same type, not
 *  a pinned twin. `serveHostMap` stamps a failed entry's evidence by passing the
 *  session's retained tail straight through (`evidence: down.log`); that only ever
 *  compiled because the two vocabularies were element-for-element identical, and this
 *  alias makes the identity the DEFINITION rather than a fact a separate file had to
 *  monitor. */
export type LogEntry = EvidenceLine;

/** The wire validator for {@link LogEntry} — it IS `@kolu/surface-map`'s
 *  {@link EvidenceLineSchema}, for the same reason {@link LogEntry} is `EvidenceLine`:
 *  one definition beats two definitions plus a guard.
 *
 *  A re-declared twin annotated `z.ZodType<LogEntry>` was the guard here before, and it
 *  did not guard in the likelier edit direction — TypeScript accepts a NARROWER schema
 *  annotated as a wider type, so adding a third `source` provenance upstream would have
 *  left this twin silently rejecting the new value at runtime while compiling clean. An
 *  alias has no direction to be blind in. */
export const LogEntrySchema = EvidenceLineSchema;

const logSchema = z.array(LogEntrySchema).readonly();

/** The browser-facing connection-health value. NOT a separate mirror type: it IS the
 *  session sum on the wire — `ConnectionInfo = SessionState<SshProv>` (below), so there
 *  is exactly ONE connection-state type family. This zod schema must exist (a wire value
 *  needs a concrete browser-safe validator, which a TS-generic type is not), so it
 *  hand-restates the same arms — but the drift risk is closed by a COMPILE-TIME pin
 *  (`connectionInfoIdentity.test-d.ts`) asserting `z.infer<typeof ConnectionInfoSchema>`
 *  ≡ `SessionState<SshProv>`: add a phase or change an invariant on one and the build
 *  fails until the other agrees, rather than a runtime zod throw. Discriminated on
 *  `phase`:
 *
 *   - UP (the ssh connector's `probing`/`provisioning` phases
 *     plus `connecting`/`connected`): carries the `log` tail + `sinceMs`, no error
 *     FIELDS. The `connected` arm ALSO carries `clockOffset` (the far-end host's
 *     wall-clock offset measured at admit off the reserved `system.clockNow`),
 *     `null` until that first probe stamps it.
 *   - `disconnected`: `error` + `cause` (`network` transport-class / `remote` refused).
 *   - `failed`: terminal, `cause` is `network | remote` — the HONEST transport class,
 *     orthogonal to terminality (a budget-exhausted silent provisioning step gives up
 *     `network`, a `MAX_CONSECUTIVE_FAILURES` rejection gives up `remote`; #1908 F3).
 *
 *  The provisioning phase NAMES are the ssh connector's own vocabulary; the value is
 *  carried on the host map's entry (whose sessions are exactly those ssh sessions), so
 *  naming them here is honest. */
const upArm = <P extends string>(phase: P) =>
  z.object({
    phase: z.literal(phase),
    log: logSchema,
    sinceMs: z.number(),
    campaignEpoch: z.number(),
  });

export const ConnectionInfoSchema = z.discriminatedUnion("phase", [
  upArm("probing"),
  upArm("provisioning"),
  upArm("connecting"),
  z.object({
    phase: z.literal("connected"),
    clockOffset: z.number().nullable(),
    log: logSchema,
    sinceMs: z.number(),
    campaignEpoch: z.number(),
  }),
  z.object({
    phase: z.literal("disconnected"),
    error: z.string(),
    cause: z.enum(["network", "remote"]),
    log: logSchema,
    sinceMs: z.number(),
    campaignEpoch: z.number(),
  }),
  z.object({
    phase: z.literal("failed"),
    error: z.string(),
    cause: z.enum(["network", "remote"]),
    log: logSchema,
    sinceMs: z.number(),
    campaignEpoch: z.number(),
  }),
]);

/** The connection value IS the session sum at the ssh connector's `Prov` — one type
 *  family, not a parallel mirror. Kept as a TYPE-ONLY alias (both imports are `import
 *  type`, fully erased, so this browser-safe module still pulls no node/server code at
 *  runtime), with the zod schema above pinned structurally equal to it. */
export type ConnectionInfo = SessionState<SshProv>;

/** The up-but-not-yet-connected phases — what a connect/progress UI narrates (the connect
 *  overlay, a per-host status/color map). The subset of `ConnectionInfo["phase"]` a UI shows
 *  WHILE a host is still coming up: the connector's provisioning phases (`SshProv`) plus the
 *  brief `connecting` handshake. `connected` (the workspace shows) and `disconnected`/`failed`
 *  (their own down-surface) are excluded. DERIVED from the one phase family so it auto-tracks
 *  any future `SshProv` phase — a UI's exhaustive `switch`/`Record` over `ConnectPhase` then
 *  fails to compile until it handles the new phase, the drift signal a hand-listed copy
 *  silently swallows. Lives HERE, beside `ConnectionInfo`, as the honest owner, so a UI that
 *  narrates only the coming-up phases (kolu's connect overlay) imports this subset rather than
 *  re-listing the literals. (A consumer whose map keys the FULL phase union keys on
 *  `ConnectionInfo["phase"]` directly — this alias is the up-but-not-yet-connected subset.) */
export type ConnectPhase = Exclude<
  ConnectionInfo["phase"],
  "connected" | "disconnected" | "failed"
>;

/** The gate-closed pending value: `connecting`, no log, zero elapsed. The canonical
 *  "coming up, nothing measured yet" `ConnectionInfo` — `sessionConnection`
 *  returns it for a member seen before its first frame (matching the coarse `connecting`),
 *  and a client renders it while a fresh entry has no fine state yet. */
export const DEFAULT_CONNECTION: ConnectionInfo = {
  phase: "connecting",
  log: [],
  sinceMs: 0,
  campaignEpoch: 0,
};

/** Project a session frame → the browser-facing {@link ConnectionInfo} — the ONE pure
 *  leaf a consumer derives the WORD from the entry with (SR9: "surface-remote exports
 *  only the projection"). A PROVABLE IDENTITY, not a re-box: `ConnectionInfo` IS
 *  `SessionState<SshProv>`, and `SessionState<Prov>` for any `Prov extends SshProv` (the
 *  ssh arm's `SshProv`, or a `never` endpoint — `never extends SshProv`) is a subtype by
 *  `Prov`-covariance, so `s` is already a `ConnectionInfo`. No arm-by-arm reconstruction,
 *  no casts, no runtime zod-throw risk — the two sums can't drift (the
 *  `connectionInfoIdentity` type-d pin enforces the schema tracks the type). Kept as a
 *  named function (rather than inlined) so every consumer that reads the entry's fine
 *  connection names the one projection — the browser-safe leaf both kolu and drishti
 *  import (never a second server-side subscription). */
export function projectConnection<Prov extends SshProv>(
  s: SessionState<Prov>,
): ConnectionInfo {
  return s;
}

/** Frames already validated by {@link sessionConnection}, keyed by REFERENCE so the entry is
 *  auto-evicted when the family replaces the frame — the validate-once-per-frame memo. */
const validatedFrames = new WeakSet<SessionState<string>>();

/** The total projection a host-map consumer feeds to `serveHostMap`'s `connection.project` —
 *  `(raw: SessionState<string> | undefined) => ConnectionInfo`, shaped to that seam so no
 *  consumer re-hand-assembles the undefined-arm + the erased-`Prov` cast. Folds the
 *  gate-closed pending value for a not-yet-seeded member (matching the coarse `connecting`
 *  arm, so the dot and word agree), and returns the frame otherwise. A host map serves
 *  over `SessionState<string>` (Prov erased to the phase top) and its sessions are ssh (or
 *  the `never` endpoint — `never extends SshProv`), so the frame IS a `ConnectionInfo`; the
 *  entries wire schema validates it. This is the ONE home for that erased-Prov CAST — it
 *  restores the real `Prov` and delegates the identity to the strict, cast-free
 *  {@link projectConnection}, so the provable-identity insight lives in exactly ONE place
 *  and `projectConnection` is the leaf every session→ConnectionInfo projection routes
 *  through (a real production consumer, not just the type-d pin).
 *
 *  The `Prov`-restore cast is GUARDED, not blind: a host map serving a `connection`
 *  payload is served over ssh-typed sessions by the pool's construction, but the erased
 *  `SessionState<string>` structurally admits any phase (and a known phase-name without its
 *  arm-specific fields — a `connected` frame missing `clockOffset`). So the WHOLE frame is
 *  validated against {@link ConnectionInfoSchema} before the cast, and a malformed / non-ssh
 *  frame FAILS LOUD (a producer defect) rather than casting a lie the wire schema would only
 *  catch downstream. On success the ORIGINAL frame is returned (never the parsed clone) —
 *  reference stability is what the entries `equals` dedup rests on, and `makeSession` stamps
 *  every arm field, so this validation never trips in steady state; it is the fail-fast
 *  belt for a future producer that forgets.
 *
 *  VALIDATE-ONCE-PER-FRAME: `serveHostMap` re-projects the SAME cached frame on every
 *  republish (O(M) per change, O(M²) per pool burst) — a `safeParse` on each would re-walk
 *  unchanged frames on the status hot path. The frame is reference-stable until its next
 *  `onState`, so the validation is memoised by frame REFERENCE ({@link validatedFrames}, a
 *  `WeakMap` auto-evicted when the frame is replaced): only a genuinely-new frame parses. */
export function sessionConnection(
  raw: SessionState<string> | undefined,
): ConnectionInfo {
  if (raw === undefined) return DEFAULT_CONNECTION;
  if (!validatedFrames.has(raw)) {
    const parsed = ConnectionInfoSchema.safeParse(raw);
    if (!parsed.success) {
      throw new Error(
        "sessionConnection: session frame is not a valid ConnectionInfo — a host map " +
          "declaring a `connection` payload must be served over ssh-typed sessions producing " +
          "valid ConnectionInfo frames (`makeSession` stamps every arm field). Failing loud " +
          `rather than casting a malformed/non-ssh frame. ${parsed.error.message}`,
      );
    }
    validatedFrames.add(raw);
  }
  // The frame IS a valid ConnectionInfo (validated above) — return it, not the clone, so
  // the reference stays stable for the entries `equals` dedup. `projectConnection` names
  // the (now-validated) identity.
  return projectConnection(raw as SessionState<SshProv>);
}
