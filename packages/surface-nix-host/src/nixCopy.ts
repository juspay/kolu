/**
 * `.drv`-copy provisioning for a remote agent.
 *
 * The model: the caller has a *derivation* (`.drv`) — a platform-
 * neutral description of how to build the agent — and ships THAT to
 * the remote, which realises (builds) it for its own architecture. No
 * pre-built linux closure smuggled onto a darwin host.
 *
 *   1. Caller passes a `/nix/store/…-agent.drv` path. The package
 *      doesn't care HOW the caller obtained it; `nix eval --raw
 *      .#packages.<system>.<agent>.drvPath` is the typical recipe
 *      (use `resolveSystem(host)` to get the remote's `<system>` first,
 *      so the derivation is for the *remote's* architecture).
 *   2. `nix copy --derivation --to ssh-ng://$host $drvPath` pushes the
 *      .drv (plus its inputs' .drvs and source paths the remote
 *      doesn't have).
 *   3. `ssh $host nix-store --realise $drvPath` builds it on the
 *      remote, returning the output path on the remote's store.
 *   4. `ssh $host nix-store --realise $out --add-root $link --indirect`
 *      pins that output behind a per-agent GC root on the target, so a
 *      `nix-collect-garbage` there can't delete the agent out from
 *      under a live session (or force a rebuild on the next reconnect).
 *      See `agentGcRootPath` for the "latest"-link semantics.
 *   5. The output path becomes `agentPath`; the caller then spawns
 *      `ssh $host $agentPath/bin/<binary> --stdio` via `HostSession`.
 *
 * Localhost shortcut: the .drv is already in the local store, so
 * `nix-store --realise` is a local build. The copy step is a no-op.
 *
 * **Nix is the contract, not the implementation.** No tarball, Docker,
 * or prebuilt-binary fallback exists or will. The whole point of this
 * package is "use Nix for cross-arch deployment of typed stdio
 * agents"; consumers that don't want Nix should pick a different
 * transport layer.
 */

import { buildSshProbeCommand, isLocalHost, NIX_SSHOPTS } from "./host";
import { runCapture, runProgress } from "./process";

export interface ProvisionOptions {
  host: string;
  /** `KOLU_AGENT_DRV` from the operator — a `/nix/store/…-agent.drv`
   *  path. The derivation is what gets shipped; the realisation
   *  happens on the target host. */
  drvPath: string;
  onProgress: (line: string) => void;
}

export type ProvisionResult =
  | { ok: true; agentPath: string }
  | { ok: false; reason: string };

/** Per-agent GC-root path for the realised output, or `null` when one
 *  can't be formed (see the localhost case below). Keyed on the .drv's
 *  name with its store hash stripped, so every version of the *same*
 *  agent maps to one fixed symlink: each realise overwrites it, the
 *  previous output drops out of the root set and becomes GC-eligible.
 *  "Pin the latest, release older hashes" — the moving-`result`
 *  behaviour `nix build` gives you, but on the target's store.
 *
 *  Remote: the path is relative, so it resolves against the ssh login
 *  user's home dir (sshd runs the command from `$HOME`). Local: there's
 *  no ssh chdir, so anchor to this process's `$HOME` explicitly — and if
 *  `$HOME` is unset we return `null` rather than a cwd-relative path
 *  that would silently root the agent in the wrong place; the caller
 *  then skips the (best-effort) pin. Parent dirs don't need
 *  pre-creating — `nix-store --add-root` makes them. */
export function agentGcRootPath(
  isLocal: boolean,
  drvPath: string,
): string | null {
  const name = drvPath
    .replace(/^.*\//, "") // drop the /nix/store/ prefix
    .replace(/\.drv$/, "") // drop the .drv suffix
    .replace(/^[0-9a-z]{32}-/, ""); // drop the store hash
  const rel = `.local/state/kolu/surface-nix-host/gcroots/${name}`;
  if (!isLocal) return rel;
  const home = process.env.HOME;
  return home ? `${home}/${rel}` : null;
}

/** Ship the `.drv` to `$host` and realise it there. Returns the
 *  output path on the *target* host, ready for
 *  `ssh $host $agentPath/bin/...`. */
export async function provisionAgent(
  opts: ProvisionOptions,
): Promise<ProvisionResult> {
  const isLocal = isLocalHost(opts.host);

  // 2. Copy the .drv (and its build-inputs) to the remote. Skipped
  //    for localhost — the .drv is already in /nix/store.
  if (!isLocal) {
    opts.onProgress(`${opts.host}: copying derivation '${opts.drvPath}'…`);
    const copyRes = await runProgress(
      "nix",
      [
        "copy",
        // We're shipping a derivation we built; the remote daemon's
        // require-sigs policy still bites unless the sender is in
        // trusted-users. `--no-check-sigs` lets the sender skip the
        // local check; the remote still needs to trust us.
        "--no-check-sigs",
        "--derivation",
        "--to",
        `ssh-ng://${opts.host}`,
        opts.drvPath,
      ],
      opts.onProgress,
      // The copy is a remote transfer that can sit idle for minutes; the
      // ssh it forks internally only honours dead-peer keepalive through
      // NIX_SSHOPTS. Without it a degraded host wedges this step forever.
      { NIX_SSHOPTS },
    );
    if (!copyRes.ok) {
      return {
        ok: false,
        reason: `${opts.host}: 'nix copy --derivation' exited with code ${copyRes.code}`,
      };
    }
    opts.onProgress(`${opts.host}: derivation copy complete`);
  }

  // 3. Realise (build) the .drv on the target. Output is the agent's
  //    nix-store path on that host.
  opts.onProgress(
    isLocal
      ? `localhost: realising '${opts.drvPath}'…`
      : `${opts.host}: realising '${opts.drvPath}' on remote…`,
  );
  const { command, args } = buildSshProbeCommand(
    opts.host,
    "nix-store",
    "--realise",
    opts.drvPath,
  );
  const realiseRes = await runCapture(command, args, opts.onProgress);
  if (!realiseRes.ok) {
    return {
      ok: false,
      reason: `${opts.host}: 'nix-store --realise' exited with code ${realiseRes.code}`,
    };
  }
  const agentPath = realiseRes.stdout.trim();
  if (agentPath.length === 0) {
    return {
      ok: false,
      reason: `${opts.host}: realise returned no output path`,
    };
  }
  opts.onProgress(`${opts.host}: agent realised at ${agentPath}`);

  // 4. Pin the realised output behind a stable, per-agent GC root.
  //    Re-realising an already-built store path is instant; the
  //    `--add-root … --indirect` registers an *indirect* root — the
  //    symlink itself — so the link can live under $HOME without write
  //    access to /nix/var/nix/gcroots. Best-effort throughout: if the
  //    root path can't be formed (local $HOME unset) or the command
  //    fails, we warn and continue — the agent at `agentPath` still
  //    runs, it's just collectable.
  const rootPath = agentGcRootPath(isLocal, opts.drvPath);
  if (rootPath === null) {
    opts.onProgress(
      `${opts.host}: HOME unset, can't place a GC root; agent runs but is unpinned`,
    );
  } else {
    opts.onProgress(`${opts.host}: pinning GC root at '${rootPath}'…`);
    const pin = buildSshProbeCommand(
      opts.host,
      "nix-store",
      "--realise",
      agentPath,
      "--add-root",
      rootPath,
      "--indirect",
    );
    const pinRes = await runCapture(pin.command, pin.args, opts.onProgress);
    if (!pinRes.ok) {
      opts.onProgress(
        `${opts.host}: GC-root pin failed (code ${pinRes.code}); agent runs but is unpinned`,
      );
    }
  }

  return { ok: true, agentPath };
}
