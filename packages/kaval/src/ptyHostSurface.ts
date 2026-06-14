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
 *  and `system.info` was added. */
export const PTY_HOST_CONTRACT_VERSION = "3.0";

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

const SystemHeartbeatOutputSchema = z.object({ ts: z.number() });

/** Host facts a client reads once per connection to compose spawn policy for
 *  *this* host — including one it isn't running on (the R-2 remote enabler).
 *  `shell`/`home` are the host's login shell and `$HOME`; `platform` is its
 *  `process.platform`; `rcDir` is the absolute directory under which the host
 *  materialises `spawn`'s `initFiles`, so the client can name them and point
 *  `argv`/`env` at their resolved paths. */
const SystemInfoOutputSchema = z.object({
  shell: z.string(),
  home: z.string(),
  platform: z.string(),
  rcDir: z.string(),
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
    /** OSC 633;E preexec command lines. */
    commandRun: {
      inputSchema: TerminalIdInputSchema,
      outputSchema: z.object({ command: z.string() }),
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
        input: z.object({
          id: PtyIdSchema,
          startLine: z.number().int().optional(),
          endLine: z.number().int().optional(),
          tailLines: z.number().int().optional(),
        }),
        output: z.object({ text: z.string() }),
      },
    },
    system: {
      version: { input: z.object({}), output: SystemVersionOutputSchema },
      heartbeat: { input: z.object({}), output: SystemHeartbeatOutputSchema },
      /** Host facts for client-side spawn-policy composition (B0). */
      info: { input: z.object({}), output: SystemInfoOutputSchema },
    },
  },
});

export type PtyHostSurface = SurfaceTypes<typeof ptyHostSurface.spec>;
export type PtyHostListEntry = z.infer<typeof TerminalListEntrySchema>;
export type PtyHostDataMsg = z.infer<typeof TerminalDataMsgSchema>;
export type PtyHostForegroundMsg = z.infer<typeof ForegroundMsgSchema>;
export type PtyHostSystemVersion = z.infer<typeof SystemVersionOutputSchema>;
export type PtyHostSystemInfo = z.infer<typeof SystemInfoOutputSchema>;
export type PtyHostInitFile = z.infer<typeof InitFileSchema>;
export type PtyHostSpawnInput = z.infer<typeof TerminalSpawnInputSchema>;
