/**
 * `ptyHostSurface` — the typed contract for talking to a `kaval`.
 *
 * `kaval` owns **only** the PTY: the node-pty children, the
 * `@xterm/headless` screen mirror, and the raw VT-derived taps. It knows
 * nothing of git / PR / agent-detection — that volatile, most-edited code
 * runs in padi, which consumes these raw taps and runs detection fresh. This
 * contract is the `PtyHost` interface projected
 * onto a wire: control RPCs (spawn / kill / write / resize / list / screen)
 * plus the raw tap streams (attach bytes · cwd · title · command-run ·
 * foreground · exit).
 *
 * Today the surviving kaval daemon serves this contract over its unix socket;
 * padi is its supervisor and primary client. `kaval-tui` reaches the same
 * surface locally, while its ssh stdio front reaches the daemon remotely. The
 * transport-independent client face (`PtyHostClient`, derived from this spec)
 * keeps those consumers invariant. The frozen control identity/drain fragment is
 * served beside this versioned surface, so connection identity is established
 * before this wire is judged for compatibility. See
 * `docs/atlas/src/content/atlas/pty-daemon.mdx` (Fresh approach).
 *
 * Contract version. Keyed on the *wire shape*, not the kolu binary — so a
 * future long-lived daemon survives kolu upgrades that don't touch this
 * shape. The consumer decides compatibility via `isContractVersionCompatible`
 * from `@kolu/surface/define`; an incompatible skew is the (rare, accepted)
 * forced restart. The *build
 * identity* — a finer per-build key for an "update pending" nudge on a
 * wire-compatible but stale survivor — remains a separate frozen-control
 * concern; this module defines only the versioned wire shape.
 *
 * Layering note. Co-locating the contract here gives `kaval` a
 * **contract-definition-only** dependency on `@kolu/surface` (just
 * `defineSurface`, which itself pulls only `effect`'s `Schema` + `RpcGroup`).
 * PTY ids
 * cross the wire as opaque strings — the host neither mints nor interprets
 * them, so it carries no domain schema; the consumer (kolu-server) validates
 * ids against its own `TerminalIdSchema` at its own boundary. The contract and
 * the host version are one change-axis (they have moved together every time
 * the host interface changed), so they must not be allowed to drift apart. The
 * accepted cost: a breaking `defineSurface` API change forces a re-release even
 * though node-pty / the screen mirror are untouched. If that ever bites, the
 * escape hatch is a standalone dependency-free contract package —
 * over-engineering today for a stably co-versioned pair.
 *
 * The wire is **fully specified** (B0, the kaval inversion): `spawn` carries
 * the complete `{argv, env, initFiles}` the host is to execute, and the host
 * derives *nothing* from its own `process.env`. All spawn policy — env basis,
 * identity vars, shell-init rcfiles — is composed by the client (kolu-server's
 * `kolu-pty`) against `system.info`'s host facts, then handed over as data.
 * The host writes the rcfiles it is given, spawns the argv verbatim, and asks
 * no questions. This is what lets a remote host run the same code with no
 * kolu in it. See `docs/atlas/src/content/atlas/pty-daemon.mdx` (B0).
 */

import type { DaemonLifetimeInfo } from "@kolu/surface-daemon";
import {
  defineSurface,
  type SurfaceTypes,
  type WireSchema,
} from "@kolu/surface/define";
import { Schema } from "effect";

/** A whole positive count — the `z.number().int().positive()` of this wire.
 *  Named once so every grid dimension, chunk bound and scrollback depth is the
 *  SAME check rather than three re-derivations that can drift. */
const PositiveInt = Schema.Int.check(Schema.isGreaterThan(0));

/** A whole non-negative count/index — the `z.number().int().nonnegative()` of
 *  this wire (line cursors, tail lengths). */
const NonNegativeInt = Schema.Int.check(Schema.isGreaterThanOrEqualTo(0));

/** The wire-shape `major.minor` version this build serves and expects.
 *  Bumped only when `ptyHostSurface` itself changes shape: minor for additive
 *  changes (a new optional field / procedure / stream), major for breaking
 *  ones. Internal refactors (the kolu binary, the provider DAG) do NOT bump
 *  it — that's the point, so a long-lived pty-host survives most kolu
 *  upgrades. Bumped to 3.0 by B0: `spawn` became fully specified (breaking)
 *  and `system.info` was added. Bumped to 3.1 (additive · minor): the
 *  host-global `inventory` stream — a daemon that predates it (a 3.0 survivor)
 *  is wire-incompatible and forced to recycle, never silently degraded to a
 *  boot-only adoption. Bumped to 3.2 (additive · minor): the new
 *  `system.processMemory` verb reports the daemon's `rss` so the server can
 *  surface kaval's memory on the rail — a 3.1 survivor (lacking the verb) is
 *  recycled on adoption rather than silently reporting no daemon memory.
 *  Bumped to 3.3 (additive · minor): the `commandRun` stream gained a required
 *  `replayed` field on each frame (snapshot-replay vs. live mark) — a 3.2
 *  survivor would serve bare `{ command }` frames the new schema rejects, so it
 *  is recycled on adoption rather than feeding the server unparseable marks.
 *  Bumped to 4.0 (breaking · major): `getScreenText`'s input was *reshaped*, not
 *  extended — the positional `startLine` / `endLine` / `tailLines` fields were
 *  removed and replaced by a single optional `extent` discriminated union
 *  ({ full | range | tail | viewport }, viewport = the host's own visible
 *  `rows`). This is NOT additive in either skew direction: a new daemon serving
 *  the 4.0 schema would silently STRIP an old 3.x client's legacy `tailLines`
 *  (zod drops unknown keys) and return the full scrollback — the exact
 *  full-buffer poll cost this change removes — while an old 3.x daemon would
 *  ignore a new client's `extent`. A major bump makes the predicate reject the
 *  skew in BOTH directions (`major` mismatch), so each side forces an honest
 *  recycle instead of a silently-wrong bound.
 *  Bumped to 5.0 (BREAKING · major): `terminalAttach` gained an `overflow`
 *  control frame — a NEW discriminant the host EMITS on the existing attach
 *  stream when it drops a slow subscriber, so a consumer re-attaches for a fresh
 *  snapshot rather than mistaking the drop for a PTY exit. Unlike the additive
 *  minor bumps above, a new EMITTED union variant is NOT backwards-compatible in
 *  the direction `isContractVersionCompatible` actually allows: an older client
 *  accepts a newer-minor daemon (reported minor >= its own), then meets an
 *  `overflow` frame its `terminalAttach` schema cannot discriminate — it either
 *  rejects the parse or writes a dataless frame. A field-add survives that
 *  direction (the old client strips the unknown key); an emitted variant does
 *  not. Every prior bump's breaking direction was new-client/old-daemon, which
 *  the predicate already recycles; this one's is old-client/new-daemon, which a
 *  minor bump would silently wave through. So it is a major bump: a 4.x peer on
 *  EITHER side is now a clean skew (recycled / refused with an honest restart
 *  message) instead of a silent mis-parse.
 *
 *  `system.version` also gained an optional `lifetime` sibling of `identity` (the
 *  daemon's `DaemonLifetimeInfo`, for the Kaval dialog's lifetime row) — added
 *  WITHOUT a contract bump, exactly like `identity` itself. `isContractVersionCompatible`
 *  only accepts `reported.minor >= expected.minor`, so a bump would make a surviving
 *  pre-field 5.0 kaval a SKEW against a freshly-deployed 5.1 padi, and a skewed kaval
 *  is RECYCLED — its live PTYs killed (unlike padi, which drains). A cosmetic readout
 *  must never cost a terminal: leaving the field optional at 5.0 keeps the survivor
 *  handshake-compatible (adopted, PTYs intact), and the reader falls back to "—" until
 *  the user's next kaval restart reports it.
 *
 *  Bumped to 5.1 (additive · minor): scrollback-backfill. Two shape changes,
 *  both breaking only in the new-client/old-daemon direction the predicate
 *  already recycles. (1) A new `terminal.getHistory` read verb serves older
 *  mirror scrollback in cursor-paged chunks (the client backfills its own
 *  scrollback as it scrolls up; `kaval-tui history` is a second consumer). (2)
 *  The `terminalAttach` `snapshot` frame gained a required `topLine` — the
 *  absolute mirror-line seed the client's backfill cursor starts from. Like the
 *  3.3 `commandRun.replayed` add, a 5.0 survivor serving a bare `{ kind, data }`
 *  snapshot frame is rejected by the new schema and RECYCLED on adoption, rather
 *  than seeding the client's backfill from a missing anchor. The attach snapshot
 *  is also now BOUNDED (the recent screenful, not the whole 10k mirror) — a
 *  payload-size change, invisible to the wire shape, so it needs no bump on its
 *  own.
 *
 *  Why the bounded snapshot stays a MINOR (the old-client/new-daemon direction).
 *  A 5.0 client accepting a 5.1 daemon (minor >= its own, the direction the
 *  predicate waves through) strips the unknown `topLine`, lacks `getHistory`, and
 *  now paints only the ~1000-line bounded snapshot where it once got the full
 *  mirror — it shows LESS scrollback. Unlike the 4.0 `getScreenText` reshape
 *  (which returned the WRONG bytes — a full buffer where a tail was asked — and
 *  mis-parsed a legacy field), this is a GRACEFUL degradation: no mis-parse, no
 *  corruption, the PTY fully usable, just a shorter cold-attach history. That is
 *  exactly the class the lifetime field above kept OPTIONAL rather than bump — "a
 *  cosmetic readout must never cost a terminal." A major here would make an old
 *  padi meeting a new surviving kaval a SKEW and RECYCLE it — killing the user's
 *  live PTYs — to buy back scrollback depth on a downgrade-only path (a newer
 *  kaval under an older padi arises only when padi is rolled BACK while its kaval
 *  survives). And the end-to-end client↔padi skew that actually reaches a browser
 *  is already refused by `PADI_SURFACE_VERSION`'s 3.0 major (the `terminalAttach`
 *  reshape). So this leg stays minor: graceful, PTY-preserving, and belt-and-
 *  suspendered by the padi major. */
/*  Bumped to 5.2 (additive · minor): the scrollback-backfill reflow guard (F3).
 *  (1) the `terminalAttach` snapshot frame carries an OPTIONAL `reflowEpoch` —
 *  the mirror's reflow generation the snapshot was serialized under; (2)
 *  `getHistory` input gains an OPTIONAL `epoch` the client echoes; (3)
 *  `getHistory` output is reshaped to a `chunk | stale` DISCRIMINATED UNION (the
 *  stale-reflow halt as its own arm, not a `stale` flag — invalid-states-
 *  unrepresentable). Together they let a client whose shared mirror a FOREIGN
 *  attach reflowed (its own `term.cols` unchanged) HALT backfill instead of
 *  splicing a duplicated/skipped band. Skew stays graceful in the accepting
 *  direction: the `stale` arm is reachable ONLY when the caller sends `epoch`, so
 *  a 5.1 client (which sends none) receives only `chunk` frames and strips the
 *  extra `kind` key — fail-open, exactly as before. The other direction
 *  (new-client/old-daemon: a 5.2 client's union schema meets a 5.1 daemon's flat
 *  reply) is the usual `reported.minor < expected.minor` recycle every minor bump
 *  already forces, before any `getHistory` call runs. */
/*  #1872 (spawn-detection): `commandRooted` — an OPTIONAL boolean added to BOTH
 *  the spawn input and the inventory list entry — rides at 5.2 with NO bump. It
 *  is a field-add, not a new emitted union variant, and its absence degrades to
 *  EXACTLY today's reading in both skew directions: a survivor daemon that never
 *  sets it, or a survivor server that strips it, simply reads every PTY as
 *  shell-rooted — the pre-fix behavior, never a mis-parse. This is the negative
 *  of the emitted-variant rule the recent worked examples teach: the #1865
 *  orphan-4.1 fold-back (an optional field kept a survivor adopted) vs #1876's
 *  incompatible-arm bump (a new emitted variant an old peer cannot discriminate,
 *  so it MUST recycle). `commandRooted` is the former, and a bump would
 *  force-recycle a surviving kaval — killing its live PTYs — to buy a feature
 *  whose absence is the status quo. Same call the `lifetime` field made at 5.0:
 *  a cosmetic/graceful readout must never cost a terminal.
 *
 *  #1872 also adds an OPTIONAL `shellJoin` to the `commandRun` frame (the retained
 *  command's quoting dialect, so a replayed seed vs a raw 633 line is reparsed with
 *  the right tokenizer) — same additive-optional call, NO bump: a survivor that
 *  omits it degrades to the raw (`string-argv`) reading, the pre-fix behavior. */
/*  Bumped to 5.3 (MINOR): the host-global `activity` stream (meaningful-output
 *  edges). This is a NEW EMITTED STREAM MEMBER, not an optional field — a survivor
 *  5.2 daemon does not serve it at all, so a 5.3 consumer subscribing would hit a
 *  missing stream. Unlike `commandRooted`/`lifetime` (optional fields whose absence
 *  degrades to the status quo), there is no graceful degradation for an absent
 *  stream live-activity cutover depends on — so the minor bump correctly
 *  force-recycles a surviving old kaval (its session parks + restores) rather than
 *  leave a consumer talking to a stream that isn't there.
 *
 *  Bumped to 6.0 (BREAKING · major): `system.processMemory` is REMOVED after padi
 *  moved both its own and kaval's RSS reads to one baked osfacts `--mem` call. A
 *  5.3 client meeting a 6.0 daemon would call a missing procedure; a 6.0 client
 *  meeting a 5.3 daemon simply leaves a dead member unused. Only a major rejects
 *  both directions, so rollback never waves the missing-procedure direction
 *  through. `system.version` is byte-for-byte unchanged — its exact schema pin
 *  remains the frozen handshake used before compatibility is judged.
 *
 *  Bumped to 7.0 (BREAKING · major) — the **protocol-epoch flag day** (PLAN D6).
 *  Nothing in the *payload* shapes below moved: every member encodes byte-for-byte
 *  as it did under zod, which the fixtures in `ptyHostSurface.test.ts` assert as
 *  literal JSON strings rather than assume. What moved is the FRAMING underneath
 *  them — this surface used to ride oRPC's base64+newline peer protocol and now
 *  rides Effect RPC ndjson. That is a declared flag day, not a negotiation: a 6.0
 *  daemon cannot be asked its version at all, because its first frame is
 *  undecodable by a 7.0 client (and vice versa). Cross-epoch peers are therefore
 *  observed as an *unspeakable protocol* at the transport — the supervisor's
 *  domain (D6/#3), never this constant's.
 *
 *  So why bump, if the lever is inert across the only boundary that changed?
 *  Because this constant is the **in-epoch skew mechanism**, and it must keep
 *  working from the flag day forward (PLAN D6's final bullet). Leaving it at "6.0"
 *  would let two mutually undecodable epochs report the SAME version string, so
 *  the first genuine in-epoch shape change would have no honest predecessor to
 *  compare against — and a `6.0`-reporting survivor adopted by a 7.x padi would be
 *  waved through as compatible on the strength of a string it can no longer even
 *  transmit. The major digit names the epoch; the minor resumes its usual additive
 *  duty from here, exactly as it did across 3.x–5.x. */
export const PTY_HOST_CONTRACT_VERSION = "7.0";

/** PTY ids are opaque strings on the wire — the host neither mints nor
 *  interprets them. kolu validates against its own `TerminalIdSchema` at its
 *  boundary; the host only round-trips the string. */
const PtyIdSchema = Schema.String;

const TerminalIdInputSchema = Schema.Struct({ id: PtyIdSchema });

/** A PTY grid — cols AND rows, together or not at all. The ONE grid rule this
 *  surface has: every member that carries a grid reuses it, so tightening the
 *  rule is one edit rather than a re-derivation per member. */
export const PtyGridSchema = Schema.Struct({
  cols: PositiveInt,
  rows: PositiveInt,
});
export type PtyGrid = typeof PtyGridSchema.Type;

/** Attach input: the PTY, plus — optionally — a grid to RESIZE it to first.
 *
 *  `resizeTo` is not a description of the caller; it is a command. The host
 *  runs the full `resize()` before serializing: SIGWINCH to the child, a reflow
 *  of the SHARED mirror, and on a width change a reflow-epoch bump that stales
 *  every other attached client's backfill cursor. Attaching is therefore a
 *  WRITE to shared, process-visible state whenever this is present and differs
 *  from the PTY's current grid; the cross-client policy is last-attach-wins.
 *
 *  It is fused with the attach on purpose: the snapshot is bytes laid out for a
 *  specific cols×rows, so resize-and-serialize must be ONE act — rather than
 *  the consumer publishing its size through a separate `resize` and hoping it
 *  lands first. When it didn't, nothing repaired the screen: a same-dimensions
 *  `resize` is (correctly) a no-op, so no SIGWINCH reached the process and the
 *  consumer was left reflowing a snapshot laid out for a width it never had.
 *  Omit it only when the caller has no grid of its own (a CLI dumping the
 *  screen), which reads the PTY at its current size.
 *
 *  OPTIONAL, and deliberately carried WITHOUT a contract bump. Absence degrades
 *  to exactly the previous reading in both skew directions (a 6.0 daemon strips
 *  it and serializes at its own size; a newer daemon serving an older padi
 *  receives none and does the same) — the `commandRooted` / `shellJoin` class
 *  this contract already documents as no-bump, not the emitted-variant class
 *  that must recycle. Bumping would force-recycle a surviving kaval, killing
 *  the user's live PTYs, to buy a graceful improvement. */
const TerminalAttachInputSchema = Schema.Struct({
  id: PtyIdSchema,
  // ONE optional composite, never two optional scalars — see the note on padi's
  // mirror of this schema. Half a grid is not a size, so it must not be a
  // sendable request rather than something each reader remembers to discard.
  //
  // `optionalKey`, never `optional` (PLAN #17): absent means ABSENT on this wire.
  // `Schema.optional` would encode an explicit `undefined` as `null`, which zod's
  // `.optional()` never did — and a `null` here is a fourth state ("resize to
  // nothing") no reader has an arm for.
  resizeTo: Schema.optionalKey(PtyGridSchema),
});

/** A file the client wants present on the host before the shell starts — a
 *  wrapper rcfile (bash `--rcfile`, zsh `ZDOTDIR/.zshrc`), named relative to
 *  the host's `rcDir` (from `system.info`). The host writes each under its
 *  `rcDir`, rejecting any name that escapes it, and removes them when the PTY
 *  exits. The *content* is the client's shell arcana; the host treats it as an
 *  opaque blob. */
const InitFileSchema = Schema.Struct({
  name: Schema.String,
  content: Schema.String,
});

const TerminalSpawnInputSchema = Schema.Struct({
  /** Caller-supplied PTY id. kolu-server mints the terminal id and passes it
   *  here so the pty-host's PTY id == kolu-server's terminal id — this is what
   *  makes reattach-by-id work across a kolu-server restart (later, once the
   *  pty-host is a surviving process). */
  id: Schema.optionalKey(PtyIdSchema),
  /** The fully resolved program + args — `argv[0]` is the shell, the rest its
   *  arguments (e.g. `["--rcfile", "<rcDir>/bashrc-<id>"]`). The host spawns it
   *  verbatim; it neither chooses the shell nor appends flags. */
  argv: Schema.Array(Schema.String).check(Schema.isMinLength(1)),
  /** True when `argv[0]` is the ROOT COMMAND itself, not a shell — a
   *  `kaval-tui create -- <cmd>` PTY (#1872). The host seeds `lastCommand` from
   *  the argv (no shell means no OSC 633;E mark) and
   *  reports the fact on the inventory row so the workspace sensors read
   *  `foreground === root` as a busy agent, not an idle shell prompt. Optional
   *  + absent = shell-rooted (today's reading) — see the contract-version note. */
  commandRooted: Schema.optionalKey(Schema.Boolean),
  /** The *resolved* working directory (the client applies its own
   *  `cwd || home || "/"` fallback — the host does not). */
  cwd: Schema.String,
  /** The complete child environment, composed by the client. The host passes
   *  it through untouched — it adds nothing from its own `process.env`. */
  env: Schema.Record(Schema.String, Schema.String),
  /** Wrapper rcfiles to materialise under the host's `rcDir` before spawn. */
  initFiles: Schema.Array(InitFileSchema),
  cols: Schema.optionalKey(PositiveInt),
  rows: Schema.optionalKey(PositiveInt),
  scrollback: Schema.optionalKey(PositiveInt),
});

const TerminalSpawnOutputSchema = Schema.Struct({
  id: PtyIdSchema,
  pid: Schema.Int,
  /** Echoes the resolved spawn cwd the client supplied — kolu-server seeds its
   *  per-terminal metadata + provider DAG from it. */
  cwd: Schema.String,
});

const TerminalWriteInputSchema = Schema.Struct({
  id: PtyIdSchema,
  data: Schema.String,
});

// The SAME grid rule the attach carries — `resize` and `attach` describe one
// value with one meaning, so they must not derive it twice. Spreading
// `PtyGridSchema.fields` is the Effect spelling of zod's `.extend` and keeps the
// encoded key order (`cols, rows, id`) byte-identical to the 6.0 wire.
const TerminalResizeInputSchema = Schema.Struct({
  ...PtyGridSchema.fields,
  id: PtyIdSchema,
});

/** A PTY the pty-host still owns. The minimal shape kolu-server needs to
 *  reattach by id across its own restart. */
const TerminalListEntrySchema = Schema.Struct({
  id: PtyIdSchema,
  pid: Schema.Int,
  cwd: Schema.String,
  lastActivity: Schema.Number,
  // Added in contract 2.1 (additive · optional): the metadata-tap snapshots, so
  // a one-shot `list` carries the full picture without per-row tap subscriptions.
  // The in-process host always populates them; `optional()` keeps an older
  // server wire-compatible with a 2.1 client.
  title: Schema.optionalKey(Schema.String),
  foregroundProcess: Schema.optionalKey(Schema.String),
  // Added for #1872 (additive · optional, NO contract bump — see the version
  // note): whether this PTY's root process IS the spawned command. The workspace
  // sensors read it to decide if `foreground === root` is an idle shell prompt
  // or a busy command-rooted agent. Absent = shell-rooted, today's reading.
  commandRooted: Schema.optionalKey(Schema.Boolean),
});

// A `Schema.Union` of `Schema.Struct`s, NOT a `Schema.TaggedUnion`: the
// discriminant is this wire's own `kind` field, not Effect's `_tag` convention,
// and renaming it would break every 6.x-era consumer's reducer AND the byte
// fixtures below. Effect's union decode tries each member, so a literal `kind`
// still discriminates exactly as zod's `discriminatedUnion` did.
const TerminalDataMsgSchema = Schema.Union([
  // `topLine` (contract 5.1) is the absolute mirror-line index of the snapshot's
  // top row — the seed the client's scrollback-backfill cursor pages older
  // history down from (`terminal.getHistory`'s first `before`). Required, and
  // riding on the SAME frame as the bytes it describes, so the seed can never
  // drift from the snapshot a client actually received.
  Schema.Struct({
    kind: Schema.Literal("snapshot"),
    data: Schema.String,
    topLine: NonNegativeInt,
    // `reflowEpoch` (contract 5.2 · additive · optional) — the mirror's reflow
    // generation this snapshot was serialized under. The client stamps it on
    // every `getHistory` so a later width reflow (this or a FOREIGN attach's
    // resize, which renumbers absolute rows) yields a no-splice `stale` reply
    // instead of a duplicated/skipped backfill band (F3). Optional so an older
    // 5.1 daemon that omits it leaves the client fail-open (no epoch → no gate,
    // the historical single-width behavior), no skew refusal.
    reflowEpoch: Schema.optionalKey(NonNegativeInt),
  }),
  Schema.Struct({ kind: Schema.Literal("delta"), data: Schema.String }),
  // The host dropped THIS attach subscriber for exceeding its buffered-chunk
  // cap (a slow consumer), then ended the stream. A pure CONTROL frame (no
  // `data`) — distinct from a PTY exit (the `exit` stream) and from a graceful
  // end, so a consumer re-attaches for a fresh snapshot instead of treating the
  // drop as terminal and freezing scrollback. Yielded as the LAST frame before
  // the stream ends. Added in contract 4.0 (BREAKING · major): a new EMITTED
  // union variant an older client can't discriminate, so a 3.x peer is a clean
  // skew rather than a silent mis-parse — see PTY_HOST_CONTRACT_VERSION.
  Schema.Struct({ kind: Schema.Literal("overflow") }),
]);

/** A membership change in the host's live-PTY set — the host-global inventory
 *  feed (contract 3.1). `snapshot` (the stream's first frame, snapshot-then-
 *  deltas) carries every live PTY; `created` / `exited` are the deltas as PTYs
 *  other clients spawn or end. A consumer subscribes once and discovers PTYs it
 *  did not spawn (a `kaval-tui create`) without polling `list`. Mirrors
 *  `TerminalDataMsgSchema`'s snapshot/delta discriminator so a client reducer
 *  replaces on snapshot and applies the deltas. */
const InventoryEventSchema = Schema.Union([
  Schema.Struct({
    kind: Schema.Literal("snapshot"),
    entries: Schema.Array(TerminalListEntrySchema),
  }),
  Schema.Struct({
    kind: Schema.Literal("created"),
    entry: TerminalListEntrySchema,
  }),
  Schema.Struct({ kind: Schema.Literal("exited"), id: PtyIdSchema }),
]);

/** One frame of the host-global `activity` stream — a PTY that just produced
 *  meaningful (non-resize) output. See the stream member below. */
const ActivityEdgeSchema = Schema.Struct({ id: PtyIdSchema });

/** Raw foreground sample (`tcgetpgrp(3)` pid + node-pty process name) — the
 *  one live PTY read agent detection needs that can't cross a wire as a
 *  synchronous getter, so the pty-host pushes it as a tap. */
const ForegroundMsgSchema = Schema.Struct({
  process: Schema.String,
  /** `Schema.optional`, NOT `optionalKey` — the one field on this wire that keeps
   *  zod's `.optional()` tolerance, and deliberately (#17 audit).
   *
   *  "No foreground pid" is a VALUE here, not an absent fact: `readForegroundPid`
   *  collapses `tcgetpgrp`'s transient `0` (the window before the child finishes
   *  `setsid`) to `undefined`, and the in-process type says so — `ForegroundSample`
   *  declares `foregroundPid: number | undefined` as a REQUIRED key. Both producers
   *  therefore write the key present-with-`undefined`: the channel publish in
   *  `ptyHost.ts` and the warm-up snapshot in `inProcessPtyHost.ts` — and the tap
   *  then FORWARDS whole samples verbatim (`for await (const sample of sub) yield
   *  sample`), which no conditional spread can discipline. Under `optionalKey` the
   *  RPC server's chunk encode rejected that frame and killed the whole foreground
   *  tap — the stream padi's agent detection runs on — invisibly, because the
   *  in-process link performs no encode and `exactOptionalPropertyTypes` is not set.
   *
   *  `optional` is `optionalKey` + `UndefinedOr`, so the emitted BYTES are
   *  unchanged (the key is omitted, never nulled) and a non-integer pid is still
   *  rejected. Pinned by a byte fixture in `ptyHostSurface.test.ts`. */
  foregroundPid: Schema.optional(Schema.Int),
});

/** The running pty-host's self-declared build identity, surfaced on
 *  `system.version` for the ChromeBar's `kaval` readout. `staleKey` is the
 *  hash of the `kaval` source closure (nix bakes `KAVAL_BUILD_ID`) — it flips
 *  iff a restart would load different pty-host wire/behaviour code, the
 *  *reported* operand of B3.4's "update pending" currency nudge (compared at
 *  the read site against the *expected* axis on padiSurface's `status`
 *  cell, `status.expectedKaval`).
 *  `navigableCommit` is the git ref this kaval was built from
 *  (`KAVAL_COMMIT_HASH`), the GitHub-clickable identity. */
export const PtyHostIdentitySchema = Schema.Struct({
  staleKey: Schema.String,
  navigableCommit: Schema.String,
});
export type PtyHostIdentity = typeof PtyHostIdentitySchema.Type;

/** The daemon's serializable lifetime policy — mirrors `@kolu/surface-daemon`'s
 *  `DaemonLifetimeInfo` (the wire projection of `DaemonLifetime`). Deliberately a
 *  SIBLING of `identity` on `system.version` rather than a member of
 *  `PtyHostIdentitySchema`: that schema doubles as padiSurface's `expectedKaval`
 *  build constant, which has no lifetime — a running daemon's lifetime is a
 *  runtime fact, not a build identity. The produce site (`inProcessPtyHost`'s
 *  `system.version`, fed `lifetimeInfo(lifetime)`) pins this shape to the spine's
 *  `DaemonLifetimeInfo`, so the two can't drift. */
export const DaemonLifetimeInfoSchema = Schema.Union([
  Schema.Struct({ kind: Schema.Literal("forever") }),
  Schema.Struct({ kind: Schema.Literal("idleTimeout"), ms: Schema.Number }),
  Schema.Struct({ kind: Schema.Literal("boundToPid"), pid: Schema.Number }),
]) satisfies WireSchema<DaemonLifetimeInfo>;

// Exported so `systemVersionShape.test.ts` can pin its exact key-set. The frozen
// control fragment now owns supervisor identity; this legacy procedure stays
// byte-identical because other consumers still read pid, lifetime, and build
// readout data from it.
export const SystemVersionOutputSchema = Schema.Struct({
  contractVersion: Schema.String,
  pid: Schema.Int,
  startedAt: Schema.Number,
  /** Optional so a future surviving daemon that predates this field stays
   *  wire-compatible without a forced restart (additive — no
   *  `PTY_HOST_CONTRACT_VERSION` bump). */
  identity: Schema.optionalKey(PtyHostIdentitySchema),
  /** The daemon's lifetime policy (`forever` in production; `boundToPid` under a
   *  test/smoke run) — surfaced for the Kaval dialog's lifetime row. Optional for
   *  the same reason as `identity`, and added the same way — WITHOUT a
   *  `PTY_HOST_CONTRACT_VERSION` bump — so a survivor predating it stays
   *  handshake-compatible (adopted, PTYs intact) rather than being recycled; the
   *  reader falls back to "—" until the next kaval restart reports it. */
  lifetime: Schema.optionalKey(DaemonLifetimeInfoSchema),
});

const SystemHeartbeatOutputSchema = Schema.Struct({
  ts: Schema.Number,
});

/** Host facts a client reads once per connection to compose spawn policy for
 *  *this* host — including one it isn't running on (the R-2 remote enabler).
 *  `shell`/`home` are the host's login shell and `$HOME`; `platform` is its
 *  `process.platform`; `rcDir` is the absolute directory under which the host
 *  materialises `spawn`'s `initFiles`, so the client can name them and point
 *  `argv`/`env` at their resolved paths; `path` is the host's `$PATH`, which a
 *  REMOTE client must put in the spawn env so the shell can find any command (a
 *  local client already has its own `$PATH`). `path` is optional so an older
 *  daemon a `--host` dial adopts (predating this field) degrades to a baseline
 *  rather than failing response validation — the same-build daemon `--host`
 *  provisions always carries it. */
const SystemInfoOutputSchema = Schema.Struct({
  shell: Schema.String,
  home: Schema.String,
  platform: Schema.String,
  rcDir: Schema.String,
  path: Schema.optionalKey(Schema.String),
});

// ── The declared error vocabulary (PLAN D4) ─────────────────────────────
//
// Two failures on this wire are ACTIONABLE — a caller branches on them — so they
// are declared as `Schema.TaggedError`es and carried by the members that
// raise them. Everything else a handler can throw (a duplicate spawn id, a
// node-pty failure, a termination deadline) stays UNDECLARED and therefore a
// DEFECT: it crosses opaquely and crashes loudly, which is the correct reading of
// "the host is broken", not "the request was refused". These two replace the
// oRPC-era `ORPCError("NOT_FOUND")` / `ORPCError("BAD_REQUEST")` codes; the
// discriminant is now the `_tag`, not a magic string compared by hand.

/** The host owns no PTY with this id — it exited, or the caller invented the id.
 *
 *  The shape kaval-tui's re-attach loop reads as "the PTY is gone" (as opposed to
 *  "the stream dropped"), which is what makes it fall through to the exit
 *  tombstone for the real exit code instead of retrying forever.
 *
 *  DECLARED on the three read procedures that raise it (`getScreenState`,
 *  `getScreenText`, `getHistory`). The five per-terminal STREAMS raise the same
 *  class, but a `StreamSpec` has no error channel to declare it on, so there it is
 *  an undeclared failure — a DEFECT, opaque across a wire hop and narrowable only
 *  in-process. That asymmetry is the framework's, not this contract's, and the
 *  corpus already asserts only "it rejects" for the stream leg because of it. */
export class PtyNotFound extends Schema.TaggedError<PtyNotFound>(
  "kaval/PtyNotFound",
)("PtyNotFound", { id: Schema.String }) {
  override get message(): string {
    return `no PTY with id ${this.id}`;
  }
}

/** `spawn` was handed an empty `argv`. Unreachable through a schema-validating
 *  client (`argv` is `minLength(1)`), so this is the wire's own second line of
 *  defence: a malformed frame becomes a clean, named refusal rather than a spawn
 *  of `undefined`. Declared so a caller composing argv programmatically gets an
 *  answer it can branch on instead of a defect. */
export class SpawnArgvEmpty extends Schema.TaggedError<SpawnArgvEmpty>(
  "kaval/SpawnArgvEmpty",
)("SpawnArgvEmpty", {}) {
  override get message(): string {
    return "argv is empty";
  }
}

export const ptyHostSurface = defineSurface({
  streams: {
    /** Per-terminal output stream — snapshot then live deltas. */
    terminalAttach: {
      inputSchema: TerminalAttachInputSchema,
      outputSchema: TerminalDataMsgSchema,
    },
    /** OSC 7 cwd reports. */
    cwd: {
      inputSchema: TerminalIdInputSchema,
      outputSchema: Schema.Struct({ cwd: Schema.String }),
    },
    /** OSC 0/2 title changes (signals "foreground may have changed"). */
    title: {
      inputSchema: TerminalIdInputSchema,
      outputSchema: Schema.Struct({ title: Schema.String }),
    },
    /** OSC 633;E preexec command lines. Snapshot-then-deltas: the first frame
     *  replays the last command seen before subscribe (`replayed: true`) so a
     *  late/restarted sensor still learns it; subsequent frames are live marks
     *  (`replayed: false`). The flag lets consumers seed detection from the
     *  replay WITHOUT re-firing live-only side effects (recent-agent recency). */
    commandRun: {
      inputSchema: TerminalIdInputSchema,
      outputSchema: Schema.Struct({
        command: Schema.String,
        replayed: Schema.Boolean,
        // #1872 (additive · optional, NO contract bump — see the version note):
        // the command's quoting dialect. `true` = the command-rooted `shellJoin`
        // seed (reparse with `shellSplit`); absent/`false` = a raw OSC 633;E line
        // (reparse with `string-argv`). Carried per frame so the snapshot replay of
        // a retained seed is reparsed correctly regardless of delivery timing; a
        // survivor that omits it degrades to the raw reading (today's behavior).
        shellJoin: Schema.optionalKey(Schema.Boolean),
      }),
    },
    /** Foreground process name + pid, sampled at the tty (deduped). */
    foreground: {
      inputSchema: TerminalIdInputSchema,
      outputSchema: ForegroundMsgSchema,
    },
    /** Child exit. Yields exactly once (the exit code), then ends. */
    exit: {
      inputSchema: TerminalIdInputSchema,
      outputSchema: Schema.Struct({ exitCode: Schema.Int }),
    },
    /** Host-global membership feed (contract 3.1) — a snapshot of every live PTY,
     *  then created/exited deltas. Takes no id (it spans the whole host), so a
     *  consumer subscribes once and discovers PTYs other clients spawned (a
     *  `kaval-tui create`) without polling `list`. */
    inventory: {
      inputSchema: Schema.Struct({}),
      outputSchema: InventoryEventSchema,
    },
    /** Host-global MEANINGFUL-OUTPUT edges (contract 5.3) — each frame names a PTY
     *  that just produced real output, with resize repaints EXCLUDED at the source.
     *  A consumer subscribes once and stamps ARRIVAL time on its own clock, deriving
     *  its own idle windows — so kaval never re-streams bytes just to maintain a
     *  boolean, and no consumer needs its own byte tap or a resize-mute hack. Purely
     *  live (no snapshot frame): a missed edge across a reconnect only delays a
     *  downstream finish (default-excluded). */
    activity: {
      inputSchema: Schema.Struct({}),
      outputSchema: ActivityEdgeSchema,
    },
  },
  procedures: {
    terminal: {
      spawn: {
        input: TerminalSpawnInputSchema,
        output: TerminalSpawnOutputSchema,
        error: SpawnArgvEmpty,
      },
      kill: {
        input: TerminalIdInputSchema,
        output: Schema.Struct({ ok: Schema.Boolean }),
      },
      killAll: {
        input: Schema.Struct({}),
        output: Schema.Struct({ killed: Schema.Int }),
      },
      write: {
        input: TerminalWriteInputSchema,
        output: Schema.Struct({ ok: Schema.Boolean }),
      },
      // `ok` is a real answer, not a constant: FALSE means the host had no such
      // PTY (it exited before the call arrived), so the caller's grid claim
      // landed on nothing. TRUE covers both a real resize and an exact
      // same-dimensions no-op — either way the PTY now holds that grid.
      resize: {
        input: TerminalResizeInputSchema,
        output: Schema.Struct({ ok: Schema.Boolean }),
      },
      list: {
        input: Schema.Struct({}),
        output: Schema.Struct({
          entries: Schema.Array(TerminalListEntrySchema),
        }),
      },
      getScreenState: {
        input: TerminalIdInputSchema,
        output: Schema.Struct({ data: Schema.String }),
        error: PtyNotFound,
      },
      getScreenText: {
        // `extent` is the single bound axis as a discriminated union, so the
        // host can't be handed two conflicting bounds (a tail AND a viewport)
        // to silently choose between — only one variant is expressible. Omit it
        // for the full buffer. `viewport` carries no payload: it resolves to the
        // last `rows` rendered lines against the host's own live grid (the CLI
        // can't know it; its stdout is usually a pipe, never the daemon
        // terminal's size).
        input: Schema.Struct({
          id: PtyIdSchema,
          extent: Schema.optionalKey(
            Schema.Union([
              Schema.Struct({ kind: Schema.Literal("full") }),
              Schema.Struct({
                kind: Schema.Literal("range"),
                startLine: Schema.optionalKey(Schema.Int),
                endLine: Schema.optionalKey(Schema.Int),
              }),
              Schema.Struct({
                kind: Schema.Literal("tail"),
                // "Last N lines" — N is a count, so a negative is meaningless.
                // Reject it at the wire boundary (fail loud) rather than letting
                // `getScreenText`'s `Math.max(0, …)` clamp turn it into a silent
                // empty read.
                lines: NonNegativeInt,
              }),
              Schema.Struct({ kind: Schema.Literal("viewport") }),
            ]),
          ),
        }),
        output: Schema.Struct({ text: Schema.String }),
        error: PtyNotFound,
      },
      /** Older-scrollback read for the client's in-place backfill (contract
       *  5.1). `before` is the caller's absolute cursor (the attach snapshot's
       *  `topLine`, then each reply's `topLine`); the host serves up to `max`
       *  mirror rows immediately ABOVE it, VT-serialized for replay. Absolute
       *  addressing keeps the seam where backfill meets existing content
       *  race-free against live output (see `PtyHistoryChunk`). `max` is a
       *  positive count — a non-positive request is a caller bug, rejected at the
       *  wire rather than silently returning nothing. */
      getHistory: {
        input: Schema.Struct({
          id: PtyIdSchema,
          // Absolute cursor; omitted starts from the top of the current screen
          // region (the self-seeding pager entry point).
          before: Schema.optionalKey(NonNegativeInt),
          max: PositiveInt,
          // `epoch` (contract 5.2 · additive · optional) — the reflow generation
          // the caller's `before` cursor was seeded under (the attach snapshot's
          // `reflowEpoch`). The host serves the `stale` output arm when it no
          // longer matches, so a client whose mirror a foreign resize reflowed
          // HALTS rather than pages a renumbered cursor (F3). Omitted by an older
          // client / the self-seeding pager — fail-open (never sees `stale`).
          epoch: Schema.optionalKey(NonNegativeInt),
        }),
        // A discriminated union, not a flat struct with a `stale` flag: the two
        // outcomes — a served chunk vs a stale-reflow halt — can't be conflated
        // (invalid-states-unrepresentable; mirrors this contract's own attach
        // `snapshot|delta` frame). The `stale` arm is only reachable when the
        // caller sends `epoch`, so an older (5.1) client — which sends none —
        // never receives it and reads every reply as a plain chunk (the extra
        // `kind` key is stripped by its flat schema); the breaking direction is
        // the usual new-client/old-daemon one the predicate already recycles.
        output: Schema.Union([
          Schema.Struct({
            kind: Schema.Literal("chunk"),
            chunk: Schema.String,
            topLine: NonNegativeInt,
            exhausted: Schema.Boolean,
          }),
          Schema.Struct({ kind: Schema.Literal("stale") }),
        ]),
        error: PtyNotFound,
      },
    },
    system: {
      version: {
        input: Schema.Struct({}),
        output: SystemVersionOutputSchema,
      },
      heartbeat: {
        input: Schema.Struct({}),
        output: SystemHeartbeatOutputSchema,
      },
      /** Host facts for client-side spawn-policy composition (B0). */
      info: { input: Schema.Struct({}), output: SystemInfoOutputSchema },
    },
  },
});

export type PtyHostSurface = SurfaceTypes<typeof ptyHostSurface.spec>;
export type PtyHostListEntry = typeof TerminalListEntrySchema.Type;
export type PtyHostDataMsg = typeof TerminalDataMsgSchema.Type;
export type PtyHostInventoryEvent = typeof InventoryEventSchema.Type;
export type PtyHostForegroundMsg = typeof ForegroundMsgSchema.Type;
export type PtyHostSystemVersion = typeof SystemVersionOutputSchema.Type;
export type PtyHostSystemInfo = typeof SystemInfoOutputSchema.Type;
export type PtyHostInitFile = typeof InitFileSchema.Type;
/** A `spawn` argument as it crosses the WIRE — the ENCODED side (D2/#13), which
 *  is what a caller passes to the client face. It is what `z.input<…>` used to
 *  mean here, and it is the side every composer (kaval-tui's `create`, the
 *  contract corpus, kolu-server's `kolu-pty`) actually holds. */
export type PtyHostSpawnInput = typeof TerminalSpawnInputSchema.Encoded;
/** The host's spawn result — `{ id, pid, cwd }`. The generative side of this
 *  shape, so a client consumes it rather than re-declaring it (and stays in sync
 *  if the host ever adds a field). */
export type PtyHostSpawnResult = typeof TerminalSpawnOutputSchema.Type;

/** The last-resort spawn shell when a client composing `spawn`'s `argv` finds
 *  no `$SHELL` to name. Matches the host's own terminal fallback
 *  (`inProcessPtyHost`'s `hostShell` ends in `/bin/sh`), so the bare client and
 *  the host agree on the same answer. One literal, shared by every composer that
 *  needs it (kaval-tui's `create`, the contract corpus) — so it can't drift. */
export const DEFAULT_SPAWN_SHELL = "/bin/sh";
