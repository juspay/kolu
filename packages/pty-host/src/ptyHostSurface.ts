/**
 * `ptyHostSurface` — the typed contract for talking to a `@kolu/pty-host`.
 *
 * `@kolu/pty-host` owns **only** the PTY: the node-pty children, the
 * `@xterm/headless` screen mirror, and the raw VT-derived taps. It knows
 * nothing of git / PR / agent-detection — that volatile, most-edited code
 * (the provider DAG) runs in kolu-server, which consumes these raw taps and
 * runs detection fresh. This contract is the `PtyHost` interface projected
 * onto a wire: control RPCs (spawn / kill / write / resize / list / screen)
 * plus the raw tap streams (attach bytes · cwd · title · command-run ·
 * foreground · exit).
 *
 * In-process today, kolu-server consumes this contract through the identity
 * link (`inProcessSurfaceClient` — `implementSurface` composed with
 * `createRouterClient`, no wire). The point of stating it as a *contract* now
 * is that the consumer is written against `ContractRouterClient<contract>`,
 * so a later step can serve the same shape over a unix socket (a surviving
 * daemon) or ssh stdio (a remote pty-host) by swapping only which morphism
 * builds the client — the consumer is invariant. See
 * `docs/plans/remote-terminals.pty-daemon.html` (#fresh-approach).
 *
 * Contract version. Keyed on the *wire shape*, not the kolu binary — so a
 * future long-lived daemon survives kolu upgrades that don't touch this
 * shape. The consumer decides compatibility via `isPtyHostContractCompatible`;
 * an incompatible skew is the (rare, accepted) forced restart. The *build
 * identity* — a finer per-build key for an "update pending" nudge on a
 * wire-compatible but stale survivor — is a separate concern layered onto
 * `system.version` later; this module defines only the wire shape.
 *
 * Layering note. Co-locating the contract here gives `@kolu/pty-host` a
 * **contract-definition-only** dependency on `@kolu/surface` (just
 * `defineSurface`, which itself pulls only `@orpc/contract` + `zod`) and on
 * `kolu-common` (the `TerminalIdSchema` domain type). It is the correct home
 * — the contract and the host version are one change-axis (they have moved
 * together every time the host interface changed), so they must not be allowed
 * to drift apart. The accepted cost: a breaking `defineSurface` API change
 * forces a `@kolu/pty-host` re-release even though node-pty / the screen mirror
 * are untouched. If that ever bites, the escape hatch is a standalone
 * dependency-free `@kolu/pty-host-contract` package — over-engineering today
 * for a stably co-versioned pair.
 */

import { defineSurface, type SurfaceTypes } from "@kolu/surface/define";
import { TerminalIdSchema } from "kolu-common/surface";
import { z } from "zod";

/** The wire-shape `major.minor` version this build serves and expects.
 *  Bumped only when `ptyHostSurface` itself changes shape: minor for additive
 *  changes (a new optional field / procedure / stream), major for breaking
 *  ones. Internal refactors (the kolu binary, the provider DAG) do NOT bump
 *  it — that's the point, so a long-lived pty-host survives most kolu
 *  upgrades. */
export const PTY_HOST_CONTRACT_VERSION = "2.0";

/** Whether a pty-host reporting `reportedVersion` is wire-compatible with a
 *  consumer built against `expected` (both `major.minor`). Compatible when the
 *  majors match and the reported minor is >= ours — additive minor bumps stay
 *  backwards-compatible; a major mismatch is a forced restart. Tolerates a
 *  trailing patch/prerelease suffix on either side (only `major.minor` is
 *  load-bearing). */
export function isPtyHostContractCompatible(
  reportedVersion: string,
  expected: string,
): boolean {
  const parse = (v: string): [number, number] | null => {
    const m = /^(\d+)\.(\d+)/.exec(v);
    return m ? [Number(m[1]), Number(m[2])] : null;
  };
  const a = parse(reportedVersion);
  const b = parse(expected);
  if (!a || !b) return false;
  return a[0] === b[0] && a[1] >= b[1];
}

const TerminalIdInputSchema = z.object({ id: TerminalIdSchema });

const TerminalSpawnInputSchema = z.object({
  /** Caller-supplied PTY id. kolu-server mints the terminal id and passes it
   *  here so the pty-host's PTY id == kolu-server's terminal id — this is what
   *  makes reattach-by-id work across a kolu-server restart (later, once the
   *  pty-host is a surviving process). */
  id: TerminalIdSchema.optional(),
  cwd: z.string().optional(),
  cols: z.number().int().positive().optional(),
  rows: z.number().int().positive().optional(),
  scrollback: z.number().int().positive().optional(),
});

const TerminalSpawnOutputSchema = z.object({
  id: TerminalIdSchema,
  pid: z.number().int(),
  /** The *resolved* spawn cwd (the pty-host applies `input.cwd || HOME || "/"`).
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

/** A PTY the pty-host still owns. The minimal shape kolu-server needs to
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
 *  one live PTY read agent detection needs that can't cross a wire as a
 *  synchronous getter, so the pty-host pushes it as a tap. */
const ForegroundMsgSchema = z.object({
  process: z.string(),
  foregroundPid: z.number().int().optional(),
});

const SystemVersionOutputSchema = z.object({
  contractVersion: z.string(),
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
