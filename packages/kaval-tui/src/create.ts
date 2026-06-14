/**
 * Pure logic for the `create` subcommand — compose the fully-specified spawn
 * input and render the result, with no I/O or transport so it is unit-testable
 * without a socket. `main.ts` is the thin glue that mints the id, fetches over
 * the contract, and prints these.
 *
 * `create` is the *raw* multiplexer's spawn: a plain login shell, no rcfiles,
 * no kolu policy. Since B0 the wire is fully specified (the host derives
 * nothing from its own env), so the client composes the whole input itself —
 * here, from kaval-tui's own `process.env`/`cwd`, the same minimal shape the
 * contract tests carry. kolu-server's rich client composes far more
 * (`composeSpawnInput`: env layering, identity vars, shell-init); kaval-tui
 * deliberately does not — a plain `$SHELL` is the point.
 */
import { randomUUID } from "node:crypto";
import type { PtyHostSpawnInput } from "kaval";
import { commandName, shortId, tildeify } from "./render.ts";

/** The pty-host's spawn result — `{ id, pid, cwd }` (TerminalSpawnOutputSchema). */
export interface CreateResult {
  id: string;
  pid: number;
  cwd: string;
}

/** The default shell when the environment names none — the same fallback the
 *  contract tests use, so a bare environment still spawns something usable. */
const DEFAULT_SHELL = "/bin/bash";

/** Compose the fully-specified spawn input for a plain shell. Pure: `id`, `cwd`,
 *  and `env` are passed in (`main.ts` supplies `randomUUID()` / `process.cwd()`
 *  / `process.env`) so the result is deterministic and testable. `argv[0]` is
 *  `$SHELL` (or `/bin/bash`), there are no rcfiles, and the env is the caller's
 *  own with `undefined` values dropped — the host writes nothing of its own. */
export function buildCreateInput(opts: {
  id: string;
  cwd: string;
  env: NodeJS.ProcessEnv;
}): PtyHostSpawnInput {
  const env: Record<string, string> = {};
  for (const [k, v] of Object.entries(opts.env)) if (v != null) env[k] = v;
  return {
    id: opts.id,
    argv: [env.SHELL || DEFAULT_SHELL],
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

/** Render the human one-liner — the short id to hand to `attach`, the shell,
 *  the resolved cwd, and the pid. Mirrors `list`'s vocabulary (`·` separators,
 *  tildeified cwd, short id). */
export function formatCreate(
  result: CreateResult,
  opts: { shell: string; home?: string },
): string {
  return `spawned ${shortId(result.id)} · ${commandName(opts.shell)} · ${tildeify(
    result.cwd,
    opts.home,
  )} (pid ${result.pid})`;
}

/** Render `create --json` — the raw `{ id, pid, cwd }` object, 2-space indented
 *  like `list --json`, carrying the FULL id for scripts (`jq -r .id`). */
export function formatCreateJson(result: CreateResult): string {
  return JSON.stringify(result, null, 2);
}
