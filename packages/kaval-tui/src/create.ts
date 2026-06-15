/**
 * Pure logic for the `create` subcommand — compose the fully-specified spawn
 * input and render the result, with no I/O or transport so it is unit-testable
 * without a socket. `main.ts` is the thin glue that mints the id, fetches over
 * the contract, and prints these.
 *
 * `create` is the *raw* multiplexer's spawn: a plain `$SHELL` (or a command
 * you pass) run with no login flag, no rcfiles, no kolu policy. Since B0 the
 * wire is fully specified (the host derives nothing from its own env), so the
 * client composes the whole input itself — here, from kaval-tui's own
 * `process.env`/`cwd`, the same
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
import { commandName, sanitizeCell, shortId, tildeify } from "./render.ts";

/** The pty-host's spawn result — `{ id, pid, cwd }` (TerminalSpawnOutputSchema).
 *  Consumes the contract's inferred type so it can't drift from the schema. */
export type CreateResult = PtyHostSpawnResult;

/** Compose the fully-specified spawn input. Pure: `id`, `cwd`, `env`, and an
 *  optional `command` are passed in (`main.ts` supplies `randomUUID()` /
 *  `process.cwd()` / `process.env` / the `[command…]` positional) so the result
 *  is deterministic and testable. `argv` is the given `command`, or `[$SHELL]`
 *  (falling back to `DEFAULT_SPAWN_SHELL`, the host-agreeing `/bin/sh`) when none
 *  is passed — a plain shell, run with no login flag. There
 *  are no rcfiles, and the env is the caller's own with `undefined` values
 *  dropped: the host writes nothing of its own.
 *
 *  This is the LOCAL-host composer: the daemon runs on this machine, so our own
 *  `process.cwd()`/`process.env`/`$SHELL` ARE the host's facts. The remote
 *  (`--host`) path must NOT use this — sending a local cwd/shell/env to a
 *  different machine is wrong (and leaks local env). It composes from the
 *  daemon's `system.info` instead — see `buildRemoteCreateInput`. */
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
  return composeCreateInput({
    id: opts.id,
    cwd: opts.cwd,
    shell: env.SHELL,
    env,
    command: opts.command,
  });
}

/** Host facts the remote (`--host`) composer reads from the daemon's
 *  `system.info` — the shell and home of the machine the PTY will actually run
 *  on, NOT this CLI's. */
export interface RemoteHostFacts {
  shell: string;
  home: string;
}

/** Presentation-only env vars safe to carry from the local CLI to a remote PTY:
 *  they describe the *terminal we're attaching with*, not the local machine's
 *  identity/secrets, so they improve the remote shell (colour, locale) without
 *  leaking anything. Everything else local stays local. */
const REMOTE_ENV_PASSTHROUGH = [
  "TERM",
  "COLORTERM",
  "LANG",
  "LC_ALL",
  "LC_CTYPE",
] as const;

/** Compose the spawn input for a REMOTE daemon (`--host`). Unlike the local
 *  composer, the cwd/shell/HOME come from the daemon's `system.info` (the
 *  machine the PTY runs on), and the env is NOT the local `process.env` — it is
 *  a minimal env built from the host's own `HOME`/`SHELL` plus only the
 *  presentation vars in `REMOTE_ENV_PASSTHROUGH`. This keeps the contract's
 *  invariant honest (the host derives nothing — the client specifies it all)
 *  while not shipping a local cwd that may not exist there or leaking local
 *  environment. cwd defaults to the host's `home` (no remote-cwd flag yet). */
export function buildRemoteCreateInput(opts: {
  id: string;
  host: RemoteHostFacts;
  /** The local CLI's env, mined ONLY for the presentation passthrough vars. */
  localEnv: NodeJS.ProcessEnv;
  command?: readonly string[];
}): PtyHostSpawnInput {
  const env: Record<string, string> = {
    HOME: opts.host.home,
    SHELL: opts.host.shell || DEFAULT_SPAWN_SHELL,
  };
  for (const k of REMOTE_ENV_PASSTHROUGH) {
    const v = opts.localEnv[k];
    if (v != null) env[k] = v;
  }
  return composeCreateInput({
    id: opts.id,
    cwd: opts.host.home,
    shell: opts.host.shell,
    env,
    command: opts.command,
  });
}

/** The shared tail both composers funnel through: pick `argv` (the given
 *  `command`, else the resolved `shell` falling back to `DEFAULT_SPAWN_SHELL`)
 *  and assemble the `{ argv, cwd, env, initFiles: [] }` wire shape. */
function composeCreateInput(opts: {
  id: string;
  cwd: string;
  shell: string | undefined;
  env: Record<string, string>;
  command?: readonly string[];
}): PtyHostSpawnInput {
  const argv =
    opts.command && opts.command.length > 0
      ? [...opts.command]
      : [opts.shell || DEFAULT_SPAWN_SHELL];
  return {
    id: opts.id,
    argv,
    cwd: opts.cwd,
    env: opts.env,
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
 *  `list`'s vocabulary (`·` separators, tildeified cwd, short id). The program
 *  basename and cwd are run through `sanitizeCell` for the same reason `list`
 *  does: a cwd (or argv[0]) carrying a newline or raw ESC would otherwise break
 *  this line's layout or inject terminal control effects. `--json` stays raw
 *  (`JSON.stringify` escapes controls). */
export function formatCreate(
  result: CreateResult,
  opts: { program: string; home?: string },
): string {
  const program = sanitizeCell(commandName(opts.program));
  const cwd = sanitizeCell(tildeify(result.cwd, opts.home));
  return `spawned ${shortId(result.id)} · ${program} · ${cwd} (pid ${result.pid})`;
}
