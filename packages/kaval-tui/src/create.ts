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
 * minimal shape the contract tests carry. padi's rich client composes far more
 * (`composeSpawnInput`: env layering, identity vars, shell-init); kaval-tui
 * deliberately does not — a plain `$SHELL` is the point.
 */
import { randomUUID } from "node:crypto";
import {
  DEFAULT_SPAWN_SHELL,
  type PtyHostSpawnInput,
  type PtyHostSpawnResult,
} from "kaval";
// The ONE shared spawn-env allowlist lives in kolu-pty (the env-policy home beside
// cleanEnv), so kaval-tui's composers cannot drift from cleanEnv / daemonEnv / the
// e2e harness. This is the #1872 structural invariant: identity cannot ride ambient
// env into any kolu-spawned process.
import { SPAWN_ENV_ALLOWLIST, SPAWN_ENV_PRESENTATION } from "kolu-pty";
import { commandName, sanitizeCell, shortId, tildeify } from "./render.ts";

/** The pty-host's spawn result — `{ id, pid, cwd }` (TerminalSpawnOutputSchema).
 *  Consumes the contract's inferred type so it can't drift from the schema. */
export type CreateResult = PtyHostSpawnResult;

/** Compose the fully-specified spawn input. Pure: `id`, `cwd`, `env`, and an
 *  optional `command`/`extraEnv` are passed in (`main.ts` supplies `randomUUID()` /
 *  `process.cwd()` / `process.env` / the `[command…]` positional / the `--env`
 *  additions) so the result is deterministic and testable. `argv` is the given
 *  `command`, or `[$SHELL]` (falling back to `DEFAULT_SPAWN_SHELL`, the
 *  host-agreeing `/bin/sh`) when none is passed — a plain shell, run with no login
 *  flag. There are no rcfiles.
 *
 *  The env is NOT the caller's own copied wholesale — it is composed from the shared
 *  {@link SPAWN_ENV_ALLOWLIST} (kolu-pty; the caller's env mined for the canonical
 *  base), then the explicit `--env K=V` additions layered on top, then the
 *  `KAVAL_SOCKET` stamp. Composing (not forwarding) is what stops an orchestrator's
 *  identity vars leaking into the child — the #1872 data loss.
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
  /** Explicit `--env K=V` additions — the caller's opt-in escape hatch for a
   *  session var the clean base drops. Layered AFTER the base, so a caller may also
   *  override a base var (e.g. a custom `PATH`). */
  extraEnv?: Record<string, string>;
  /** The socket this daemon was dialed on, stamped as `KAVAL_SOCKET` so a process
   *  inside the spawned terminal can reach the daemon that owns it — the same
   *  `$TMUX` convention padi follows. Overwrites any inherited value from
   *  `opts.env`: the child is owned by THIS daemon, not an outer one. */
  kavalSocket: string;
}): PtyHostSpawnInput {
  const env: Record<string, string> = {};
  for (const k of SPAWN_ENV_ALLOWLIST) {
    const v = opts.env[k];
    if (v != null) env[k] = v;
  }
  for (const [k, v] of Object.entries(opts.extraEnv ?? {})) env[k] = v;
  env.KAVAL_SOCKET = opts.kavalSocket;
  return composeCreateInput({
    id: opts.id,
    cwd: opts.cwd,
    shell: env.SHELL,
    env,
    command: opts.command,
  });
}

/** Host facts the remote (`--host`) composer reads from the daemon's
 *  `system.info` — the shell, home, and `$PATH` of the machine the PTY will
 *  actually run on, NOT this CLI's. `path` is optional: a daemon predating the
 *  `system.info.path` field returns none, and the composer falls back to a
 *  baseline so the remote shell still finds the common tools. */
export interface RemoteHostFacts {
  shell: string;
  home: string;
  path?: string;
}

/** A usable PATH for a remote shell when the host daemon didn't report its own
 *  (an older adopted daemon). Covers NixOS (`/run/current-system/sw/bin`) and
 *  the FHS bins, so `sleep`/`ls`/etc. resolve. The same-build daemon `--host`
 *  provisions reports its real `$PATH`, so this is only the degraded path. */
const BASELINE_REMOTE_PATH =
  "/run/current-system/sw/bin:/usr/local/bin:/usr/bin:/bin:/usr/local/sbin:/usr/sbin:/sbin";

/** Compose the spawn input for a REMOTE daemon (`--host`). Unlike the local
 *  composer, the cwd/shell/HOME come from the daemon's `system.info` (the
 *  machine the PTY runs on), and the env is NOT the local `process.env` — it is
 *  a minimal env built from the host's own `HOME`/`SHELL` plus only the
 *  presentation vars in the shared `SPAWN_ENV_PRESENTATION` (kolu-pty). This keeps the contract's
 *  invariant honest (the host derives nothing — the client specifies it all)
 *  while not shipping a local cwd that may not exist there or leaking local
 *  environment. cwd defaults to the host's `home` (no remote-cwd flag yet). */
export function buildRemoteCreateInput(opts: {
  id: string;
  host: RemoteHostFacts;
  /** The local CLI's env, mined ONLY for the presentation passthrough vars. */
  localEnv: NodeJS.ProcessEnv;
  command?: readonly string[];
  /** Explicit `--env K=V` additions — same escape hatch as the local composer, so
   *  the flag behaves identically whether or not `--host` is given (a create flag
   *  that silently no-ops under `--host` would be a fail-fast violation). Layered
   *  after the host base, so it can also override a host-derived var. */
  extraEnv?: Record<string, string>;
}): PtyHostSpawnInput {
  const env: Record<string, string> = {
    HOME: opts.host.home,
    SHELL: opts.host.shell || DEFAULT_SPAWN_SHELL,
    // The host's PATH (not ours — local store paths don't exist there). Without
    // it the remote shell finds no external command and the PTY exits 127 on the
    // first one. Falls back to a baseline if an older daemon didn't report it.
    PATH: opts.host.path || BASELINE_REMOTE_PATH,
  };
  for (const k of SPAWN_ENV_PRESENTATION) {
    const v = opts.localEnv[k];
    if (v != null) env[k] = v;
  }
  for (const [k, v] of Object.entries(opts.extraEnv ?? {})) env[k] = v;
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
 *  and assemble the `{ argv, cwd, env, initFiles: [] }` wire shape.
 *
 *  Stamps `KAVAL_TERMINAL_ID` (this terminal's own id) so a process inside can
 *  name itself — the self-knowledge twin of the `KAVAL_SOCKET` stamp, matching
 *  padi's rich composer (`composeSpawnInput`). Set last so it overwrites any value inherited
 *  from the caller's env (this CLI running inside an outer kolu terminal): the
 *  child is its own terminal, not the outer one. Applies to both the local and
 *  remote (`--host`) composers — the id is the terminal's, wherever it runs. */
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
    env: { ...opts.env, KAVAL_TERMINAL_ID: opts.id },
    initFiles: [],
  };
}

/** Mint a fresh PTY id client-side — padi mints its terminal id the same
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
