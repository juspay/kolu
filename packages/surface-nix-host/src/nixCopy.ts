/**
 * `.drv`-copy provisioning for a remote agent.
 *
 * The model: the caller has a *derivation* (`.drv`) — a platform-
 * neutral description of how to build the agent — and ships THAT to
 * the remote, which realises (builds) it for its own architecture. No
 * pre-built linux closure smuggled onto a darwin host.
 *
 *   Preamble: the caller passes a `/nix/store/…-agent.drv` path. The
 *      package doesn't care HOW the caller obtained it; `nix eval --raw
 *      .#packages.<system>.<agent>.drvPath` is the typical recipe
 *      (use `resolveSystem(host)` to get the remote's `<system>` first,
 *      so the derivation is for the *remote's* architecture).
 *   1. (Remote, warm) `ssh $host nix-store --realise $drvPath --add-root
 *      $link --indirect`. If the closure is already on the host this one
 *      fused command confirms presence (realise fast-fails when the
 *      closure is absent and unsubstitutable), refreshes the GC root, and
 *      returns the out-path — so a warm host short-circuits here, skipping
 *      the redundant copy/realise/pin below. On a miss we fall through.
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
 *   Spawn: the output path becomes `agentPath`; the caller then spawns
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

import {
  buildSshProbeCommand,
  type FailureCause,
  isLocalHost,
  looksLikeNetworkError,
  nixSshOpts,
} from "./host";
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
  // `cause` lets `HostSession` keep retrying a host that went unreachable
  // *mid-provision* (asleep/roaming after the arch probe succeeded) instead
  // of burning the give-up budget — while a genuine `"remote"` rejection
  // (e.g. `trusted-users`) still fails loudly. See `FailureCause`.
  | { ok: false; reason: string; cause: FailureCause };

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

/** Realise `target` on `$host` AND register an indirect GC root at
 *  `rootPath` in one ssh command — the single shape both the warm probe
 *  (target = the `.drv`) and the cold pin (target = the realised out-path)
 *  share. Defined once so the root flags, option ordering, and
 *  `--indirect` semantics live in exactly one place. */
function realiseAndPin(host: string, target: string, rootPath: string) {
  return buildSshProbeCommand(
    host,
    "nix-store",
    "--realise",
    target,
    "--add-root",
    rootPath,
    "--indirect",
  );
}

/** Ship the `.drv` to `$host` and realise it there. Returns the
 *  output path on the *target* host, ready for
 *  `ssh $host $agentPath/bin/...`. */
export async function provisionAgent(
  opts: ProvisionOptions,
): Promise<ProvisionResult> {
  const isLocal = isLocalHost(opts.host);

  // Watch the streamed output for ssh/nix connection errors as it flows by,
  // so a host that went unreachable mid-`nix copy` (which exits with nix's
  // code, not ssh's 255) is still classified `"network"`. We only flip a
  // flag — no buffering of the (potentially large) transfer log.
  let sawNetworkError = false;
  // Scan a line for a transport failure so an unreachable host is classified
  // `"network"` no matter which step's stderr first carries the error. Shared
  // by the visible progress wrapper and the suppressed probe callback below.
  const scanForNetworkError = (line: string): void => {
    if (looksLikeNetworkError(line)) sawNetworkError = true;
  };
  const onProgress = (line: string): void => {
    scanForNetworkError(line);
    opts.onProgress(line);
  };
  // The warm probe is *speculative*: on a cold host it's expected to fail
  // (the `.drv` isn't there yet), and nix writes a real `error: …` line to
  // stderr before we fall through and provision successfully. Forwarding that
  // line into the user-visible progress ring would make a clean first-time
  // provision read as if it errored. So the probe's stderr is scanned for the
  // network classification (a transport failure here must still flip
  // `sawNetworkError` so the fall-through's `causeFor` calls an unreachable
  // host `"network"`) but NOT echoed to `opts.onProgress`. The real
  // copy/realise path below reports its own errors verbatim if provisioning
  // ultimately fails.
  const onProbeProgress = scanForNetworkError;
  // A direct-ssh command (realise/pin) surfaces ssh's own 255 on a transport
  // failure; combined with the stderr scan this covers both the copy step
  // (nix-wrapped ssh) and the realise step (bare ssh).
  const causeFor = (code: number | null): FailureCause =>
    sawNetworkError || code === 255 ? "network" : "remote";

  const rootPath = agentGcRootPath(isLocal, opts.drvPath);

  // 1. Warm fast-path (remote only). If the .drv's closure is already on the
  //    host, ONE fused `--realise <drv> --add-root … --indirect` both proves it
  //    (realise fast-fails when the closure is absent and unsubstitutable) and
  //    refreshes the GC root — so a warm host skips the redundant `nix copy`
  //    (the wasteful "copying 0 paths" step) plus the separate realise/pin it
  //    otherwise re-pays on every dial. On a miss (drv absent → fast-fail, or an
  //    unwritable root) we fall through to the full provision below, whose pin
  //    is best-effort, so a root issue degrades to "works, unpinned" rather than
  //    a hard failure. Localhost never copies anyway (the .drv is already in the
  //    local store), so the fast-path is remote-only — its one ssh would be pure
  //    overhead locally. The probe's stderr is scanned for the network
  //    classification (via `onProbeProgress`) but NOT echoed to the
  //    user-visible progress ring — its expected miss on a cold host would
  //    otherwise make a clean first-time provision read as an error — so a
  //    transport failure here still classifies the fall-through as `"network"`.
  if (!isLocal && rootPath !== null) {
    const warm = realiseAndPin(opts.host, opts.drvPath, rootPath);
    const warmRes = await runCapture(warm.command, warm.args, onProbeProgress);
    const warmPath = warmRes.stdout.trim();
    if (warmRes.ok && warmPath.length > 0) {
      onProgress(
        `${opts.host}: already provisioned at ${warmPath} — skipped copy`,
      );
      return { ok: true, agentPath: warmPath };
    }
  }

  // 2. Copy the .drv (and its build-inputs) to the remote. Skipped
  //    for localhost — the .drv is already in /nix/store.
  if (!isLocal) {
    onProgress(`${opts.host}: copying derivation '${opts.drvPath}'…`);
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
      onProgress,
      // The copy is a remote transfer that can sit idle for minutes; the
      // ssh it forks internally only honours dead-peer keepalive — and the
      // P2.8 ControlMaster multiplexing — through NIX_SSHOPTS. Without the
      // keepalive a degraded host wedges this step forever; with the control
      // opts this fork rides the master the warm probe already opened
      // instead of paying its own handshake. `nixSshOpts()` renders both.
      { NIX_SSHOPTS: nixSshOpts() },
    );
    if (!copyRes.ok) {
      return {
        ok: false,
        reason: `${opts.host}: 'nix copy --derivation' exited with code ${copyRes.code}`,
        cause: causeFor(copyRes.code),
      };
    }
    onProgress(`${opts.host}: derivation copy complete`);
    // The copy reached the host, so it's provably reachable *now* — clear any
    // network flag a speculative warm-probe blip set. Without this, a transient
    // probe network error that cleared by the time we copied would make a
    // subsequent genuine *remote* realise/pin failure misclassify as `"network"`
    // (retrying forever instead of giving up). Each later step's own stderr scan
    // re-sets the flag if the host goes unreachable again.
    sawNetworkError = false;
  }

  // 3. Realise (build) the .drv on the target. Output is the agent's
  //    nix-store path on that host.
  onProgress(
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
  const realiseRes = await runCapture(command, args, onProgress);
  if (!realiseRes.ok) {
    return {
      ok: false,
      reason: `${opts.host}: 'nix-store --realise' exited with code ${realiseRes.code}`,
      cause: causeFor(realiseRes.code),
    };
  }
  const agentPath = realiseRes.stdout.trim();
  if (agentPath.length === 0) {
    return {
      ok: false,
      reason: `${opts.host}: realise returned no output path`,
      // The build ran and returned cleanly but empty — a remote-state
      // anomaly, not a transport failure.
      cause: "remote",
    };
  }
  onProgress(`${opts.host}: agent realised at ${agentPath}`);

  // 4. Pin the realised output behind a stable, per-agent GC root.
  //    Re-realising an already-built store path is instant; the
  //    `--add-root … --indirect` registers an *indirect* root — the
  //    symlink itself — so the link can live under $HOME without write
  //    access to /nix/var/nix/gcroots. Best-effort throughout: if the
  //    root path can't be formed (local $HOME unset) or the command
  //    fails, we warn and continue — the agent at `agentPath` still
  //    runs, it's just collectable.
  if (rootPath === null) {
    opts.onProgress(
      `${opts.host}: HOME unset, can't place a GC root; agent runs but is unpinned`,
    );
  } else {
    opts.onProgress(`${opts.host}: pinning GC root at '${rootPath}'…`);
    const pin = realiseAndPin(opts.host, agentPath, rootPath);
    const pinRes = await runCapture(pin.command, pin.args, opts.onProgress);
    if (!pinRes.ok) {
      opts.onProgress(
        `${opts.host}: GC-root pin failed (code ${pinRes.code}); agent runs but is unpinned`,
      );
    }
  }

  return { ok: true, agentPath };
}
