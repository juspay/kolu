/**
 * Pure logic for the `create` subcommand — compose the fully-specified spawn
 * input and render the result, with no I/O or transport so it is unit-testable
 * without a socket. `main.ts` is the thin glue that mints the id, fetches over
 * the contract, and prints these.
 *
 * `create` is the *raw* multiplexer's spawn: a plain login shell (or a command
 * you pass), no rcfiles, no kolu policy. Since B0 the wire is fully specified
 * (the host derives nothing from its own env), so the client composes the whole
 * input itself — here, from kaval-tui's own `process.env`/`cwd`, the same
 * minimal shape the contract tests carry. kolu-server's rich client composes far more
 * (`composeSpawnInput`: env layering, identity vars, shell-init); kaval-tui
 * deliberately does not — a plain `$SHELL` is the point.
 */
import { randomUUID } from "node:crypto";
import {
  DEFAULT_SPAWN_SHELL,
  type PtyHostSpawnInput,
  type PtyHostSpawnResult,
} from "kaval";
import { commandName, shortId, tildeify } from "./render.ts";

/** The pty-host's spawn result — `{ id, pid, cwd }` (TerminalSpawnOutputSchema).
 *  Consumes the contract's inferred type so it can't drift from the schema. */
export type CreateResult = PtyHostSpawnResult;

/** Compose the fully-specified spawn input. Pure: `id`, `cwd`, `env`, and an
 *  optional `command` are passed in (`main.ts` supplies `randomUUID()` /
 *  `process.cwd()` / `process.env` / the `[command…]` positional) so the result
 *  is deterministic and testable. `argv` is the given `command`, or `[$SHELL]`
 *  (falling back to `DEFAULT_SPAWN_SHELL`, the host-agreeing `/bin/sh`) when none
 *  is passed — a plain login shell. There
 *  are no rcfiles, and the env is the caller's own with `undefined` values
 *  dropped: the host writes nothing of its own. */
export function buildCreateInput(opts: {
  id: string;
  cwd: string;
  env: NodeJS.ProcessEnv;
  /** Program + args to run instead of a plain shell — the `[command…]`
   *  positional (`kaval-tui create -- htop -d 5`). Empty/absent → `$SHELL`. */
  command?: readonly string[];
}): PtyHostSpawnInput {
  const env: Record<string, string> = {};
  for (const [k, v] of Object.entries(opts.env)) if (v != null) env[k] = v;
  const argv =
    opts.command && opts.command.length > 0
      ? [...opts.command]
      : [env.SHELL || DEFAULT_SPAWN_SHELL];
  return {
    id: opts.id,
    argv,
    cwd: opts.cwd,
    env,
    initFiles: [],
  };
}

/** Mint a fresh PTY id client-side — kolu-server mints its terminal id the same
 *  way (`crypto.randomUUID()`), so the pty-host's PTY id is the caller's id and
 *  the returned `id` echoes what we sent. */
export function newPtyId(): string {
  return randomUUID();
}

/** Render the human one-liner — the short id to hand to `attach`, the program
 *  (`$SHELL` or the command's basename), the resolved cwd, and the pid. Mirrors
 *  `list`'s vocabulary (`·` separators, tildeified cwd, short id). */
export function formatCreate(
  result: CreateResult,
  opts: { program: string; home?: string },
): string {
  return `spawned ${shortId(result.id)} · ${commandName(opts.program)} · ${tildeify(
    result.cwd,
    opts.home,
  )} (pid ${result.pid})`;
}

/** Render `create --json` — the raw `{ id, pid, cwd }` object, 2-space indented
 *  like `list --json`, carrying the FULL id for scripts (`jq -r .id`). */
export function formatCreateJson(result: CreateResult): string {
  return JSON.stringify(result, null, 2);
}
