/**
 * Agent installation — ship the kolu binary to a remote SSH host.
 *
 * Plan B's pivot for binary shipping: the remote already has Nix
 * (kolu's entire user base does — that's how they got kolu), so
 * shipping the agent reduces to:
 *
 *   ssh $host nix run <flakeRef> -- --stdio
 *
 * Nix on the remote handles arch resolution, closure realisation,
 * substitution, content-addressed dedup, and verification. The remote
 * builds (or substitutes) the right derivation for its own system —
 * no local cross-build, no nix copy of cross-arch closures (which
 * fail with `Exec format error` when the local builder can't run the
 * remote's binaries).
 *
 * **Configuration**: `KOLU_AGENT_FLAKE_REF` env var (default
 * `github:juspay/kolu/remote-terminals-plan-b-r2`). For dev: set it to
 * a local-pushed branch. For prod: pin to a tag.
 *
 * **Why not `nix copy` from local?** The earlier draft built kolu for
 * the remote system locally (`nix build --system <remoteSystem>`) and
 * `nix copy`'d the result. Cross-arch builds fail without a remote
 * builder set up exactly right (the linux box has to either own the
 * darwin binaries via substituter or offload to a remote darwin
 * builder; the latter requires `max-jobs 0` plus `system-features
 * matching plus trusted-user permission). Side-stepping all of that
 * by having the remote do `nix run` natively is the simpler shape.
 */

import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { log } from "./log.ts";

const execFileP = promisify(execFile);

/** Flake ref that exposes the kolu `default` package. Settable via
 *  `KOLU_AGENT_FLAKE_REF` env var; defaults to the remote-terminals
 *  branch on juspay/kolu (the only branch with `kolu --stdio` until
 *  R-2 lands on master). */
function getAgentFlakeRef(): string {
  return (
    process.env.KOLU_AGENT_FLAKE_REF ??
    "github:juspay/kolu/remote-terminals-plan-b-r2"
  );
}

/**
 * "Install" the kolu agent on `host` — for the `nix run` strategy this
 * is a no-op probe: we ssh once to verify the host responds and nix is
 * available. The first `nix run` invocation on the remote does the
 * real "install" (substitute or build the closure).
 *
 * Future enhancement: pre-warm the closure with a one-off
 * `ssh $host nix build --no-link <flakeRef>` so the first real
 * terminal-spawn isn't waiting on the cold build.
 */
export async function installAgent(host: string): Promise<void> {
  const flakeRef = getAgentFlakeRef();
  log.info({ host, flakeRef }, "installAgent: probing remote nix");
  try {
    const { stdout } = await execFileP("ssh", [host, "nix", "--version"]);
    log.info({ host, nixVersion: stdout.trim() }, "installAgent: nix probe ok");
  } catch (err) {
    log.error({ host, err }, "installAgent: nix probe failed");
    throw new Error(
      `installAgent(${host}): nix not available on remote. Plan B assumes Nix-on-remote. ` +
        `Underlying: ${err instanceof Error ? err.message : String(err)}`,
    );
  }
  log.info(
    { host, flakeRef },
    "installAgent: ok (the closure realises lazily on first agent spawn)",
  );
}

/** Build the remote command that runs `kolu --stdio` from the
 *  configured flake ref via `nix run`. Used by `HostSession` when
 *  spawning the ssh subprocess.
 *
 *  The chain is: `ssh $host -- nix run <flakeRef> -- --stdio`. The
 *  remote nix realises the closure (substituter cache hit, or local
 *  build) and executes `<storePath>/bin/kolu --stdio`. */
export function remoteAgentCommand(host: string): string[] {
  const flakeRef = getAgentFlakeRef();
  return [
    "ssh",
    host,
    "nix",
    "run",
    "--accept-flake-config",
    // `--refresh` so nix re-resolves the flake ref on every connect.
    // Without it, the remote caches the resolved store path and keeps
    // running an older build of the agent — which silently breaks
    // contract changes (e.g. terminal.spawn input added an `id` field
    // and old agents ignore it, so their generated id mismatches the
    // kolu server's pre-generated id and every later terminal.write /
    // resize fails with "terminal not found on agent").
    "--refresh",
    flakeRef,
    "--",
    "--stdio",
  ];
}
