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
 *  message) instead of a silent mis-parse. */
export const PTY_HOST_CONTRACT_VERSION = "5.0";

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
});

const TerminalDataMsgSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("snapshot"), data: z.string() }),
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
 *  the read site against the server's *expected* `buildInfo.expectedKaval`).
 *  `navigableCommit` is the git ref this kaval was built from
 *  (`KAVAL_COMMIT_HASH`), the GitHub-clickable identity. */
export const PtyHostIdentitySchema = z.object({
  staleKey: z.string(),
  navigableCommit: z.string(),
});
export type PtyHostIdentity = z.infer<typeof PtyHostIdentitySchema>;

const SystemVersionOutputSchema = z.object({
  contractVersion: z.string(),
  pid: z.number().int(),
  startedAt: z.number(),
  /** Optional so a future surviving daemon that predates this field stays
   *  wire-compatible without a forced restart (additive — no
   *  `PTY_HOST_CONTRACT_VERSION` bump). */
  identity: PtyHostIdentitySchema.optional(),
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
