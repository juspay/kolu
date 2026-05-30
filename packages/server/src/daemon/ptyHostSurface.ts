/**
 * `ptyHostSurface` — the typed wire shape the `kolu --stdio` **PTY-host
 * daemon** serves (#951 R4c).
 *
 * The daemon owns **only `@kolu/pty-host`** — the node-pty children, the
 * `@xterm/headless` screen mirror, and the raw VT-derived taps. It runs
 * **zero providers**: git / PR / agent-detection (the volatile, most-edited
 * code) stays in kolu-server, which consumes these raw taps over the socket
 * and runs the provider DAG fresh on every restart. That split is the whole
 * point of the R4c redo — a long-lived daemon that survives a deploy must be
 * *thin and version-stable*, or it serves stale detection (the #1031 prod
 * failure). See `docs/plans/remote-terminals.html` (#r4-boundary).
 *
 * So this contract is the `PtyHost` interface projected onto a unix socket:
 * control RPCs (spawn / kill / write / resize / list / screen) plus the raw
 * tap streams (attach bytes · cwd · title · command-run · **foreground** ·
 * exit). The same shape rides ssh stdio for R-2's remote pty-host.
 *
 * Contract version. Keyed on the *wire shape*, not the kolu binary hash, so
 * the long-lived daemon survives most kolu upgrades. kolu-server decides
 * compatibility via `isPtyHostContractCompatible`; an incompatible skew is a
 * forced restart (PTY loss, the rare accepted cost). The *build identity*
 * (`system.version.buildId`) is the separate, finer key for the
 * "update pending" nudge — a wire-compatible daemon running stale code.
 */

import { defineSurface, type SurfaceTypes } from "@kolu/surface/define";
import { z } from "zod";
import { TerminalIdSchema } from "kolu-common/surface";

/** The wire-shape `major.minor` version this build serves and expects.
 *  Bumped only when `ptyHostSurface` itself changes shape: minor for
 *  additive changes (new optional field / procedure / stream), major for
 *  breaking ones. Internal refactors (the kolu binary, the provider DAG) do
 *  NOT bump it — that's the point, so the daemon survives most kolu upgrades.
 *
 *  **2.0** is the redo's first contract: it deliberately breaks compatibility
 *  with the dropped #1031 daemon (which served a `"1.0"` agent surface with
 *  an aggregated `agentMetadata` stream and providers *inside* the daemon).
 *  The first deploy carrying this code therefore treats any surviving #1031
 *  daemon as incompatible → forced restart, the one-time migration cutover. */
export const PTY_HOST_CONTRACT_VERSION = "2.0";

/** Whether a daemon reporting `daemonVersion` is wire-compatible with a
 *  kolu-server built against `expected` (both `major.minor`). Compatible when
 *  the majors match and the daemon's minor is >= ours — additive minor bumps
 *  stay backwards-compatible; a major mismatch is a forced restart. Tolerates
 *  a trailing patch/prerelease suffix on either side (only `major.minor` is
 *  load-bearing). */
export function isPtyHostContractCompatible(
  daemonVersion: string,
  expected: string,
): boolean {
  const parse = (v: string): [number, number] | null => {
    const m = /^(\d+)\.(\d+)/.exec(v);
    return m ? [Number(m[1]), Number(m[2])] : null;
  };
  const a = parse(daemonVersion);
  const b = parse(expected);
  if (!a || !b) return false;
  return a[0] === b[0] && a[1] >= b[1];
}

const TerminalIdInputSchema = z.object({ id: TerminalIdSchema });

const TerminalSpawnInputSchema = z.object({
  /** Caller-supplied PTY id. kolu-server mints the terminal id and passes it
   *  here so the daemon's PTY id == kolu-server's terminal id — this is what
   *  makes reattach-by-id work across a kolu-server restart. */
  id: TerminalIdSchema.optional(),
  cwd: z.string().optional(),
  cols: z.number().int().positive().optional(),
  rows: z.number().int().positive().optional(),
  scrollback: z.number().int().positive().optional(),
});

const TerminalSpawnOutputSchema = z.object({
  id: TerminalIdSchema,
  pid: z.number().int(),
  /** The *resolved* spawn cwd (the daemon applies `input.cwd || HOME || "/"`).
   *  kolu-server seeds its per-terminal metadata + provider DAG from it. */
  cwd: z.string(),
});

const TerminalWriteInputSchema = z.object({
  id: TerminalIdSchema,
  data: z.string(),
});

const TerminalResizeInputSchema = z.object({
  id: TerminalIdSchema,
  cols: z.number().int().positive(),
  rows: z.number().int().positive(),
});

/** A PTY the daemon still owns. The minimal shape kolu-server needs to
 *  reattach by id across its own restart. */
const TerminalListEntrySchema = z.object({
  id: TerminalIdSchema,
  pid: z.number().int(),
  cwd: z.string(),
  lastActivity: z.number(),
});

const TerminalDataMsgSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("snapshot"), data: z.string() }),
  z.object({ kind: z.literal("delta"), data: z.string() }),
]);

/** Raw foreground sample (`tcgetpgrp(3)` pid + node-pty process name) — the
 *  one live PTY read agent detection needs that can't cross a socket as a
 *  synchronous getter, so the daemon pushes it as a tap. */
const ForegroundMsgSchema = z.object({
  process: z.string(),
  foregroundPid: z.number().int().optional(),
});

const SystemVersionOutputSchema = z.object({
  contractVersion: z.string(),
  /** Identity of the running **pty-host source** (the `KOLU_PTY_HOST_BUILD_ID`
   *  hash nix bakes from `packages/pty-host/`, or the dev source dir) — the
   *  staleness key the "update pending" nudge fires on, NOT the whole-binary
   *  nix store hash and NOT the inert `pkgVersion`. Keying on just the pty-host
   *  source means `outdated` flips only when a restart picks up new terminal-
   *  host code. See `server/src/daemon/buildId.ts`. */
  buildId: z.string(),
  pid: z.number().int(),
  startedAt: z.number(),
});

const SystemHeartbeatOutputSchema = z.object({ ts: z.number() });

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
          id: TerminalIdSchema,
          startLine: z.number().int().optional(),
          endLine: z.number().int().optional(),
        }),
        output: z.object({ text: z.string() }),
      },
    },
    system: {
      version: { input: z.object({}), output: SystemVersionOutputSchema },
      heartbeat: { input: z.object({}), output: SystemHeartbeatOutputSchema },
    },
  },
});

export type PtyHostSurface = SurfaceTypes<typeof ptyHostSurface.spec>;
export type PtyHostListEntry = z.infer<typeof TerminalListEntrySchema>;
export type PtyHostDataMsg = z.infer<typeof TerminalDataMsgSchema>;
export type PtyHostForegroundMsg = z.infer<typeof ForegroundMsgSchema>;
export type PtyHostSystemVersion = z.infer<typeof SystemVersionOutputSchema>;
