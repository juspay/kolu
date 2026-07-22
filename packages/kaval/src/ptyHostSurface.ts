/**
 * `ptyHostSurface` — the typed contract for talking to a `kaval`.
 *
 * `kaval` owns **only** the PTY: the node-pty children, the
 * `@xterm/headless` screen mirror, and the raw VT-derived taps. It knows
 * nothing of git / PR / agent-detection — that volatile, most-edited code
 * (the provider DAG) runs in kolu-server, which consumes these raw taps and
 * runs detection fresh. This contract is the `PtyHost` interface projected
 * onto a wire: control RPCs (spawn / kill / write / resize / list / screen)
 * plus the raw tap streams (attach bytes · cwd · title · command-run ·
 * foreground · exit).
 *
 * In-process today, kolu-server consumes this contract through the identity
 * link (`directLink` over `servePtyHost`'s router — `implementSurface` with no
 * wire). The point of stating it as a *contract* now
 * is that the consumer is written against `ContractRouterClient<contract>`,
 * so a later step can serve the same shape over a unix socket (a surviving
 * daemon) or ssh stdio (a remote pty-host) by swapping only which morphism
 * builds the client — the consumer is invariant. See
 * `docs/atlas/src/content/atlas/pty-daemon.mdx` (Fresh approach).
 *
 * Contract version. Keyed on the *wire shape*, not the kolu binary — so a
 * future long-lived daemon survives kolu upgrades that don't touch this
 * shape. The consumer decides compatibility via `isContractVersionCompatible`
 * from `@kolu/surface/define`; an incompatible skew is the (rare, accepted)
 * forced restart. The *build
 * identity* — a finer per-build key for an "update pending" nudge on a
 * wire-compatible but stale survivor — is a separate concern layered onto
 * `system.version` later; this module defines only the wire shape.
 *
 * Layering note. Co-locating the contract here gives `kaval` a
 * **contract-definition-only** dependency on `@kolu/surface` (just
 * `defineSurface`, which itself pulls only `@orpc/contract` + `zod`). PTY ids
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
import { defineSurface, type SurfaceTypes } from "@kolu/surface/define";
import { z } from "zod";

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
 *  leave a consumer talking to a stream that isn't there. */
export const PTY_HOST_CONTRACT_VERSION = "5.3";

/** PTY ids are opaque strings on the wire — the host neither mints nor
 *  interprets them. kolu validates against its own `TerminalIdSchema` at its
 *  boundary; the host only round-trips the string. */
const PtyIdSchema = z.string();

const TerminalIdInputSchema = z.object({ id: PtyIdSchema });

/** A file the client wants present on the host before the shell starts — a
 *  wrapper rcfile (bash `--rcfile`, zsh `ZDOTDIR/.zshrc`), named relative to
 *  the host's `rcDir` (from `system.info`). The host writes each under its
 *  `rcDir`, rejecting any name that escapes it, and removes them when the PTY
 *  exits. The *content* is the client's shell arcana; the host treats it as an
 *  opaque blob. */
const InitFileSchema = z.object({
  name: z.string(),
  content: z.string(),
});

const TerminalSpawnInputSchema = z.object({
  /** Caller-supplied PTY id. kolu-server mints the terminal id and passes it
   *  here so the pty-host's PTY id == kolu-server's terminal id — this is what
   *  makes reattach-by-id work across a kolu-server restart (later, once the
   *  pty-host is a surviving process). */
  id: PtyIdSchema.optional(),
  /** The fully resolved program + args — `argv[0]` is the shell, the rest its
   *  arguments (e.g. `["--rcfile", "<rcDir>/bashrc-<id>"]`). The host spawns it
   *  verbatim; it neither chooses the shell nor appends flags. */
  argv: z.array(z.string()).min(1),
  /** True when `argv[0]` is the ROOT COMMAND itself, not a shell — a
   *  `kaval-tui create -- <cmd>` PTY (#1872). The host seeds `lastCommand` from
   *  the argv (no shell means no OSC 633;E mark) and
   *  reports the fact on the inventory row so the workspace sensors read
   *  `foreground === root` as a busy agent, not an idle shell prompt. Optional
   *  + absent = shell-rooted (today's reading) — see the contract-version note. */
  commandRooted: z.boolean().optional(),
  /** The *resolved* working directory (the client applies its own
   *  `cwd || home || "/"` fallback — the host does not). */
  cwd: z.string(),
  /** The complete child environment, composed by the client. The host passes
   *  it through untouched — it adds nothing from its own `process.env`. */
  env: z.record(z.string(), z.string()),
  /** Wrapper rcfiles to materialise under the host's `rcDir` before spawn. */
  initFiles: z.array(InitFileSchema),
  cols: z.number().int().positive().optional(),
  rows: z.number().int().positive().optional(),
  scrollback: z.number().int().positive().optional(),
});

const TerminalSpawnOutputSchema = z.object({
  id: PtyIdSchema,
  pid: z.number().int(),
  /** Echoes the resolved spawn cwd the client supplied — kolu-server seeds its
   *  per-terminal metadata + provider DAG from it. */
  cwd: z.string(),
});

const TerminalWriteInputSchema = z.object({
  id: PtyIdSchema,
  data: z.string(),
});

const TerminalResizeInputSchema = z.object({
  id: PtyIdSchema,
  cols: z.number().int().positive(),
  rows: z.number().int().positive(),
});

/** A PTY the pty-host still owns. The minimal shape kolu-server needs to
 *  reattach by id across its own restart. */
const TerminalListEntrySchema = z.object({
  id: PtyIdSchema,
  pid: z.number().int(),
  cwd: z.string(),
  lastActivity: z.number(),
  // Added in contract 2.1 (additive · optional): the metadata-tap snapshots, so
  // a one-shot `list` carries the full picture without per-row tap subscriptions.
  // The in-process host always populates them; `optional()` keeps an older
  // server wire-compatible with a 2.1 client.
  title: z.string().optional(),
  foregroundProcess: z.string().optional(),
  // Added for #1872 (additive · optional, NO contract bump — see the version
  // note): whether this PTY's root process IS the spawned command. The workspace
  // sensors read it to decide if `foreground === root` is an idle shell prompt
  // or a busy command-rooted agent. Absent = shell-rooted, today's reading.
  commandRooted: z.boolean().optional(),
});

const TerminalDataMsgSchema = z.discriminatedUnion("kind", [
  // `topLine` (contract 5.1) is the absolute mirror-line index of the snapshot's
  // top row — the seed the client's scrollback-backfill cursor pages older
  // history down from (`terminal.getHistory`'s first `before`). Required, and
  // riding on the SAME frame as the bytes it describes, so the seed can never
  // drift from the snapshot a client actually received.
  z.object({
    kind: z.literal("snapshot"),
    data: z.string(),
    topLine: z.number().int().nonnegative(),
    // `reflowEpoch` (contract 5.2 · additive · optional) — the mirror's reflow
    // generation this snapshot was serialized under. The client stamps it on
    // every `getHistory` so a later width reflow (this or a FOREIGN attach's
    // resize, which renumbers absolute rows) yields a no-splice `stale` reply
    // instead of a duplicated/skipped backfill band (F3). Optional so an older
    // 5.1 daemon that omits it leaves the client fail-open (no epoch → no gate,
    // the historical single-width behavior), no skew refusal.
    reflowEpoch: z.number().int().nonnegative().optional(),
  }),
  z.object({ kind: z.literal("delta"), data: z.string() }),
  // The host dropped THIS attach subscriber for exceeding its buffered-chunk
  // cap (a slow consumer), then ended the stream. A pure CONTROL frame (no
  // `data`) — distinct from a PTY exit (the `exit` stream) and from a graceful
  // end, so a consumer re-attaches for a fresh snapshot instead of treating the
  // drop as terminal and freezing scrollback. Yielded as the LAST frame before
  // the stream ends. Added in contract 4.0 (BREAKING · major): a new EMITTED
  // union variant an older client can't discriminate, so a 3.x peer is a clean
  // skew rather than a silent mis-parse — see PTY_HOST_CONTRACT_VERSION.
  z.object({ kind: z.literal("overflow") }),
]);

/** A membership change in the host's live-PTY set — the host-global inventory
 *  feed (contract 3.1). `snapshot` (the stream's first frame, snapshot-then-
 *  deltas) carries every live PTY; `created` / `exited` are the deltas as PTYs
 *  other clients spawn or end. A consumer subscribes once and discovers PTYs it
 *  did not spawn (a `kaval-tui create`) without polling `list`. Mirrors
 *  `TerminalDataMsgSchema`'s snapshot/delta discriminator so a client reducer
 *  replaces on snapshot and applies the deltas. */
const InventoryEventSchema = z.discriminatedUnion("kind", [
  z.object({
    kind: z.literal("snapshot"),
    entries: z.array(TerminalListEntrySchema),
  }),
  z.object({ kind: z.literal("created"), entry: TerminalListEntrySchema }),
  z.object({ kind: z.literal("exited"), id: PtyIdSchema }),
]);

/** One frame of the host-global `activity` stream — a PTY that just produced
 *  meaningful (non-resize) output. See the stream member below. */
const ActivityEdgeSchema = z.object({ id: PtyIdSchema });

/** Raw foreground sample (`tcgetpgrp(3)` pid + node-pty process name) — the
 *  one live PTY read agent detection needs that can't cross a wire as a
 *  synchronous getter, so the pty-host pushes it as a tap. */
const ForegroundMsgSchema = z.object({
  process: z.string(),
  foregroundPid: z.number().int().optional(),
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
export const PtyHostIdentitySchema = z.object({
  staleKey: z.string(),
  navigableCommit: z.string(),
});
export type PtyHostIdentity = z.infer<typeof PtyHostIdentitySchema>;

/** The daemon's serializable lifetime policy — mirrors `@kolu/surface-daemon`'s
 *  `DaemonLifetimeInfo` (the wire projection of `DaemonLifetime`). Deliberately a
 *  SIBLING of `identity` on `system.version` rather than a member of
 *  `PtyHostIdentitySchema`: that schema doubles as padiSurface's `expectedKaval`
 *  build constant, which has no lifetime — a running daemon's lifetime is a
 *  runtime fact, not a build identity. The produce site (`inProcessPtyHost`'s
 *  `system.version`, fed `lifetimeInfo(lifetime)`) pins this shape to the spine's
 *  `DaemonLifetimeInfo`, so the two can't drift. */
export const DaemonLifetimeInfoSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("forever") }),
  z.object({ kind: z.literal("idleTimeout"), ms: z.number() }),
  z.object({ kind: z.literal("boundToPid"), pid: z.number() }),
]) satisfies z.ZodType<DaemonLifetimeInfo>;

// Exported so `systemVersionShape.test.ts` can pin its exact key-set: `system.version`
// is the supervisor's VERSION-AGNOSTIC identity read (the convergence kit reads
// `{ contractVersion, identity.staleKey }` off it BEFORE the compat check — Pin 3), so a
// silent field rename/removal here must fail loudly rather than break that frozen read.
export const SystemVersionOutputSchema = z.object({
  contractVersion: z.string(),
  pid: z.number().int(),
  startedAt: z.number(),
  /** Optional so a future surviving daemon that predates this field stays
   *  wire-compatible without a forced restart (additive — no
   *  `PTY_HOST_CONTRACT_VERSION` bump). */
  identity: PtyHostIdentitySchema.optional(),
  /** The daemon's lifetime policy (`forever` in production; `boundToPid` under a
   *  test/smoke run) — surfaced for the Kaval dialog's lifetime row. Optional for
   *  the same reason as `identity`, and added the same way — WITHOUT a
   *  `PTY_HOST_CONTRACT_VERSION` bump — so a survivor predating it stays
   *  handshake-compatible (adopted, PTYs intact) rather than being recycled; the
   *  reader falls back to "—" until the next kaval restart reports it. */
  lifetime: DaemonLifetimeInfoSchema.optional(),
});

const SystemHeartbeatOutputSchema = z.object({
  ts: z.number(),
});

/** The daemon's resident-set size (`process.memoryUsage().rss`, bytes) at reply
 *  time — its own atomic verb so it changes for its own reason (what
 *  process-memory facts the rail wants), independent of `system.heartbeat`'s
 *  pure liveness round-trip. The server folds `rss` onto the rail's kaval memory
 *  readout. */
const SystemProcessMemoryOutputSchema = z.object({
  rss: z.number(),
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
const SystemInfoOutputSchema = z.object({
  shell: z.string(),
  home: z.string(),
  platform: z.string(),
  rcDir: z.string(),
  path: z.string().optional(),
});

export const ptyHostSurface = defineSurface({
  streams: {
    /** Per-terminal output stream — snapshot then live deltas. */
    terminalAttach: {
      inputSchema: TerminalIdInputSchema,
      outputSchema: TerminalDataMsgSchema,
    },
    /** OSC 7 cwd reports. */
    cwd: {
      inputSchema: TerminalIdInputSchema,
      outputSchema: z.object({ cwd: z.string() }),
    },
    /** OSC 0/2 title changes (signals "foreground may have changed"). */
    title: {
      inputSchema: TerminalIdInputSchema,
      outputSchema: z.object({ title: z.string() }),
    },
    /** OSC 633;E preexec command lines. Snapshot-then-deltas: the first frame
     *  replays the last command seen before subscribe (`replayed: true`) so a
     *  late/restarted sensor still learns it; subsequent frames are live marks
     *  (`replayed: false`). The flag lets consumers seed detection from the
     *  replay WITHOUT re-firing live-only side effects (recent-agent recency). */
    commandRun: {
      inputSchema: TerminalIdInputSchema,
      outputSchema: z.object({
        command: z.string(),
        replayed: z.boolean(),
        // #1872 (additive · optional, NO contract bump — see the version note):
        // the command's quoting dialect. `true` = the command-rooted `shellJoin`
        // seed (reparse with `shellSplit`); absent/`false` = a raw OSC 633;E line
        // (reparse with `string-argv`). Carried per frame so the snapshot replay of
        // a retained seed is reparsed correctly regardless of delivery timing; a
        // survivor that omits it degrades to the raw reading (today's behavior).
        shellJoin: z.boolean().optional(),
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
      outputSchema: z.object({ exitCode: z.number().int() }),
    },
    /** Host-global membership feed (contract 3.1) — a snapshot of every live PTY,
     *  then created/exited deltas. Takes no id (it spans the whole host), so a
     *  consumer subscribes once and discovers PTYs other clients spawned (a
     *  `kaval-tui create`) without polling `list`. */
    inventory: {
      inputSchema: z.object({}),
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
      inputSchema: z.object({}),
      outputSchema: ActivityEdgeSchema,
    },
  },
  procedures: {
    terminal: {
      spawn: {
        input: TerminalSpawnInputSchema,
        output: TerminalSpawnOutputSchema,
      },
      kill: {
        input: TerminalIdInputSchema,
        output: z.object({ ok: z.boolean() }),
      },
      killAll: {
        input: z.object({}),
        output: z.object({ killed: z.number().int() }),
      },
      write: {
        input: TerminalWriteInputSchema,
        output: z.object({ ok: z.boolean() }),
      },
      resize: {
        input: TerminalResizeInputSchema,
        output: z.object({ ok: z.boolean() }),
      },
      list: {
        input: z.object({}),
        output: z.object({ entries: z.array(TerminalListEntrySchema) }),
      },
      getScreenState: {
        input: TerminalIdInputSchema,
        output: z.object({ data: z.string() }),
      },
      getScreenText: {
        // `extent` is the single bound axis as a discriminated union, so the
        // host can't be handed two conflicting bounds (a tail AND a viewport)
        // to silently choose between — only one variant is expressible. Omit it
        // for the full buffer. `viewport` carries no payload: it resolves to the
        // last `rows` rendered lines against the host's own live grid (the CLI
        // can't know it; its stdout is usually a pipe, never the daemon
        // terminal's size).
        input: z.object({
          id: PtyIdSchema,
          extent: z
            .discriminatedUnion("kind", [
              z.object({ kind: z.literal("full") }),
              z.object({
                kind: z.literal("range"),
                startLine: z.number().int().optional(),
                endLine: z.number().int().optional(),
              }),
              z.object({
                kind: z.literal("tail"),
                // "Last N lines" — N is a count, so a negative is meaningless.
                // Reject it at the wire boundary (fail loud) rather than letting
                // `getScreenText`'s `Math.max(0, …)` clamp turn it into a silent
                // empty read.
                lines: z.number().int().nonnegative(),
              }),
              z.object({ kind: z.literal("viewport") }),
            ])
            .optional(),
        }),
        output: z.object({ text: z.string() }),
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
        input: z.object({
          id: PtyIdSchema,
          // Absolute cursor; omitted starts from the top of the current screen
          // region (the self-seeding pager entry point).
          before: z.number().int().nonnegative().optional(),
          max: z.number().int().positive(),
          // `epoch` (contract 5.2 · additive · optional) — the reflow generation
          // the caller's `before` cursor was seeded under (the attach snapshot's
          // `reflowEpoch`). The host serves the `stale` output arm when it no
          // longer matches, so a client whose mirror a foreign resize reflowed
          // HALTS rather than pages a renumbered cursor (F3). Omitted by an older
          // client / the self-seeding pager — fail-open (never sees `stale`).
          epoch: z.number().int().nonnegative().optional(),
        }),
        // A discriminated union, not a flat struct with a `stale` flag: the two
        // outcomes — a served chunk vs a stale-reflow halt — can't be conflated
        // (invalid-states-unrepresentable; mirrors this contract's own attach
        // `snapshot|delta` frame). The `stale` arm is only reachable when the
        // caller sends `epoch`, so an older (5.1) client — which sends none —
        // never receives it and reads every reply as a plain chunk (the extra
        // `kind` key is stripped by its flat schema); the breaking direction is
        // the usual new-client/old-daemon one the predicate already recycles.
        output: z.discriminatedUnion("kind", [
          z.object({
            kind: z.literal("chunk"),
            chunk: z.string(),
            topLine: z.number().int().nonnegative(),
            exhausted: z.boolean(),
          }),
          z.object({ kind: z.literal("stale") }),
        ]),
      },
    },
    system: {
      version: { input: z.object({}), output: SystemVersionOutputSchema },
      heartbeat: { input: z.object({}), output: SystemHeartbeatOutputSchema },
      /** The daemon's own process RSS — its own atomic verb so liveness and
       *  process-memory observability change for unrelated reasons (3.2). */
      processMemory: {
        input: z.object({}),
        output: SystemProcessMemoryOutputSchema,
      },
      /** Host facts for client-side spawn-policy composition (B0). */
      info: { input: z.object({}), output: SystemInfoOutputSchema },
    },
  },
});

export type PtyHostSurface = SurfaceTypes<typeof ptyHostSurface.spec>;
export type PtyHostListEntry = z.infer<typeof TerminalListEntrySchema>;
export type PtyHostDataMsg = z.infer<typeof TerminalDataMsgSchema>;
export type PtyHostInventoryEvent = z.infer<typeof InventoryEventSchema>;
export type PtyHostForegroundMsg = z.infer<typeof ForegroundMsgSchema>;
export type PtyHostSystemVersion = z.infer<typeof SystemVersionOutputSchema>;
export type PtyHostSystemInfo = z.infer<typeof SystemInfoOutputSchema>;
export type PtyHostInitFile = z.infer<typeof InitFileSchema>;
export type PtyHostSpawnInput = z.infer<typeof TerminalSpawnInputSchema>;
/** The host's spawn result — `{ id, pid, cwd }`. The generative side of this
 *  shape, so a client consumes it rather than re-declaring it (and stays in sync
 *  if the host ever adds a field). */
export type PtyHostSpawnResult = z.infer<typeof TerminalSpawnOutputSchema>;

/** The last-resort spawn shell when a client composing `spawn`'s `argv` finds
 *  no `$SHELL` to name. Matches the host's own terminal fallback
 *  (`inProcessPtyHost`'s `hostShell` ends in `/bin/sh`), so the bare client and
 *  the host agree on the same answer. One literal, shared by every composer that
 *  needs it (kaval-tui's `create`, the contract corpus) — so it can't drift. */
export const DEFAULT_SPAWN_SHELL = "/bin/sh";
