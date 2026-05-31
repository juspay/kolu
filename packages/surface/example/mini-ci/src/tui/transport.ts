/**
 * Transport command builders — how the TUI launches the runner.
 *
 * The whole point of mini-ci is that the *link* is the only thing that
 * changes between "run it here" and "run it over there":
 *
 *   - local mode  → spawn `tsx runner/main.ts --stdio` as a child (dev
 *                   ergonomics: we're already in the workspace).
 *   - remote mode → ship a clean source snapshot with
 *                   `git archive HEAD | ssh host 'tar -x -C dir'`, then run
 *                   `nix run path:<dir>#mini-ci-runner -- --stdio` on the
 *                   host. **All target hosts have Nix**, so the host builds
 *                   the runner itself — no node/pnpm/tsx assumed on PATH,
 *                   and Nix supplies the workspace deps. This is the "source,
 *                   not a closure" cousin of remote-process-monitor, which
 *                   `nix copy`s a *prebuilt* closure over ssh.
 *
 * Both produce a `{ command, args }` the TUI spawns with `stdio: pipe,pipe`
 * and hands to one `stdioLink`.
 *
 * The ssh dead-peer keepalive policy (`SSH_COMMON_OPTS`) and the
 * localhost-vs-ssh check (`isLocalHost`) are reused from
 * `@kolu/surface-nix-host` — the same source of truth drishti's `HostSession`
 * uses — rather than re-deriving them here. (We can't reuse `HostSession`
 * itself: its provisioning is nix-*closure*-coupled — `provisionAgent` +
 * `${agentPath}/bin/${binary}` — whereas mini-ci ships source; growing
 * `HostSession` a pluggable provisioner is the seam that would let both share
 * the ref-count + reconnect machinery, and is recorded as a framework finding
 * in the README.)
 *
 * These builders are pure (no spawning) so the "only the link differs" claim
 * is unit-testable at the argv level — see `mini-ci.test.ts`.
 */

import { fileURLToPath } from "node:url";
import { SSH_COMMON_OPTS } from "@kolu/surface-nix-host";

/** Absolute path to the runner entrypoint, resolved relative to this file
 *  (used for the local `tsx` spawn). */
export const RUNNER_MAIN = fileURLToPath(
  new URL("../runner/main.ts", import.meta.url),
);

/** The flake attribute the remote builds + runs. */
export const RUNNER_FLAKE_ATTR = "mini-ci-runner";

/** Default extraction directory on the remote host. */
export const DEFAULT_REMOTE_DIR = "/tmp/mini-ci-src";

export interface Spawnable {
  command: string;
  args: string[];
}

export interface LocalOptions {
  pipeline?: string;
}

export interface RemoteOptions {
  host: string;
  remoteDir?: string;
  pipeline?: string;
}

/** Local: run the runner. Under `nix run .#mini-ci` the wrapper injects
 *  `MINI_CI_RUNNER` (the prebuilt `mini-ci-runner` binary), since `pnpm`/
 *  `tsx` aren't on the wrapper's PATH; in the dev tree we run it under the
 *  workspace's `tsx`. */
export function buildLocalRunnerCommand(opts: LocalOptions = {}): Spawnable {
  const runnerBin = process.env.MINI_CI_RUNNER;
  const pipelineArgs =
    opts.pipeline !== undefined ? ["--pipeline", opts.pipeline] : [];
  if (runnerBin !== undefined && runnerBin !== "") {
    return { command: runnerBin, args: ["--stdio", ...pipelineArgs] };
  }
  return {
    command: "pnpm",
    args: ["exec", "tsx", RUNNER_MAIN, "--stdio", ...pipelineArgs],
  };
}

/** The `git archive HEAD | ssh host 'tar -x'` ship — returned as two halves
 *  the caller pipes together (git stdout → ssh stdin). No `.git`, no nix
 *  closure: the minimal, dependency-free way to get the flake source onto
 *  the host so it can `nix run` the runner. */
export function buildShipCommand(opts: RemoteOptions): {
  archive: Spawnable;
  extract: Spawnable;
} {
  const dir = opts.remoteDir ?? DEFAULT_REMOTE_DIR;
  return {
    archive: { command: "git", args: ["archive", "HEAD"] },
    extract: {
      command: "ssh",
      args: [
        ...SSH_COMMON_OPTS,
        opts.host,
        // Wipe-then-extract so each ship is a clean snapshot — a stale tree
        // from a prior run would leave cruft beside the fresh flake.
        `rm -rf ${shellQuote(dir)} && mkdir -p ${shellQuote(dir)} && tar -x -C ${shellQuote(dir)}`,
      ],
    },
  };
}

/** Remote: build + run the runner on `host` from the shipped flake source,
 *  attached over `ssh` stdio. */
export function buildRemoteRunnerCommand(opts: RemoteOptions): Spawnable {
  const dir = opts.remoteDir ?? DEFAULT_REMOTE_DIR;
  const pipelineFlag =
    opts.pipeline !== undefined
      ? ` --pipeline ${shellQuote(opts.pipeline)}`
      : "";
  // Quote the flakeref so the remote shell keeps the `#attr` literal (a bare
  // `#` would start a comment), and shell-quote `dir` so a user-supplied
  // `--remote-dir` with spaces or metacharacters doesn't break the command.
  // Nix's own build logs go to stderr, leaving stdout as the oRPC protocol
  // channel.
  const flakeref = shellQuote(`path:${dir}#${RUNNER_FLAKE_ATTR}`);
  const remoteCmd = `nix run ${flakeref} --accept-flake-config -- --stdio${pipelineFlag}`;
  return { command: "ssh", args: [...SSH_COMMON_OPTS, opts.host, remoteCmd] };
}

/** POSIX single-quote escaping — wraps in `'…'` and escapes embedded
 *  quotes as `'\''`. */
export function shellQuote(value: string): string {
  return `'${value.replace(/'/g, `'\\''`)}'`;
}
