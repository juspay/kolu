/**
 * `.drv`-copy provisioning for the remote agent.
 *
 * The model: the parent has a *derivation* (`.drv`) — a platform-
 * neutral description of how to build the agent — and ships THAT to
 * the remote, which realises (builds) it for its own architecture. No
 * pre-built linux closure smuggled onto a darwin host.
 *
 *   1. Operator sets `KOLU_AGENT_DRV` to a `/nix/store/…-agent.drv`
 *      path. No fallback — if unset, the parent fails loudly. (Lesson
 *      #2: matched-pair-by-operator-named-input; same shape R-2's
 *      `KOLU_AGENT_FLAKE_REF` will take.)
 *   2. `nix copy --to ssh-ng://$host --derivation $KOLU_AGENT_DRV`
 *      pushes the .drv (plus its inputs' .drvs and source paths the
 *      remote doesn't have).
 *   3. `ssh $host nix-store --realise $KOLU_AGENT_DRV` builds it on
 *      the remote, returning the output path on the remote's store.
 *   4. The output path becomes `agentPath`; the parent then
 *      `ssh $host $agentPath/bin/process-monitor-agent --stdio`s.
 *
 * Localhost shortcut: the .drv is already in the local store, so
 * `nix-store --realise` is just a local build. The copy step is a
 * no-op.
 *
 * Computing `KOLU_AGENT_DRV` is the operator's job — the just recipe
 * does it via `nix eval --raw .#packages.<system>.process-monitor-agent.drvPath`,
 * detecting the remote's system via `ssh $host uname -ms` first. That
 * way the derivation is built for the *remote's* architecture even
 * when the parent is a different OS/arch.
 */

import { spawn } from "node:child_process";
import { forEachLine, isLocalHost } from "./host";

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

/** Ship the `.drv` to `$host` and realise it there. Returns the
 *  output path on the *target* host, ready for
 *  `ssh $host $agentPath/bin/...`. */
export async function provisionAgent(
  opts: ProvisionOptions,
): Promise<ProvisionResult> {
  const isLocal = isLocalHost(opts.host);

  // 1. Copy the .drv (and its build-inputs) to the remote. Skipped
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
    );
    if (!copyRes.ok) {
      return {
        ok: false,
        reason: `${opts.host}: 'nix copy --derivation' exited with code ${copyRes.code}`,
      };
    }
    opts.onProgress(`${opts.host}: derivation copy complete`);
  }

  // 2. Realise (build) the .drv on the target. Output is the agent's
  //    nix-store path on that host.
  opts.onProgress(
    isLocal
      ? `localhost: realising '${opts.drvPath}'…`
      : `${opts.host}: realising '${opts.drvPath}' on remote…`,
  );
  const realiseArgv = isLocal
    ? ["nix-store", "--realise", opts.drvPath]
    : [
        "ssh",
        "-o",
        "BatchMode=yes",
        opts.host,
        "nix-store",
        "--realise",
        opts.drvPath,
      ];
  const realiseRes = await runCapture(
    realiseArgv[0] as string,
    realiseArgv.slice(1),
    opts.onProgress,
  );
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
  return { ok: true, agentPath };
}

interface ExitResult {
  ok: boolean;
  code: number | null;
}
interface CaptureResult extends ExitResult {
  stdout: string;
}

/** Run a child process with stdout ignored; forward stderr lines to
 *  `onProgress`. Used for `nix copy` where the only output the parent
 *  cares about is progress chatter on stderr. */
function runProgress(
  cmd: string,
  args: readonly string[],
  onProgress: (line: string) => void,
): Promise<ExitResult> {
  return new Promise((resolve) => {
    const proc = spawn(cmd, [...args], { stdio: ["ignore", "ignore", "pipe"] });
    proc.stderr?.setEncoding("utf-8");
    proc.stderr?.on("data", (chunk: string) => forEachLine(chunk, onProgress));
    // Use "close" (not "exit") so the last stderr chunk is guaranteed
    // flushed before we resolve — "exit" fires before stdio streams drain.
    proc.on("close", (code) => resolve({ ok: code === 0, code }));
    proc.on("error", (err) => {
      onProgress(`${cmd}: ${err.message}`);
      resolve({ ok: false, code: null });
    });
  });
}

/** Run a child process and buffer its stdout; forward stderr lines to
 *  `onProgress`. Used for `nix-store --realise` where the output path
 *  comes back on stdout. */
function runCapture(
  cmd: string,
  args: readonly string[],
  onProgress: (line: string) => void,
): Promise<CaptureResult> {
  return new Promise((resolve) => {
    const proc = spawn(cmd, [...args], { stdio: ["ignore", "pipe", "pipe"] });
    let stdout = "";
    proc.stdout?.setEncoding("utf-8");
    proc.stdout?.on("data", (chunk: string) => {
      stdout += chunk;
    });
    proc.stderr?.setEncoding("utf-8");
    proc.stderr?.on("data", (chunk: string) => forEachLine(chunk, onProgress));
    // Use "close" (not "exit") so stdout/stderr are fully drained first.
    proc.on("close", (code) => resolve({ ok: code === 0, code, stdout }));
    proc.on("error", (err) => {
      onProgress(`${cmd}: ${err.message}`);
      resolve({ ok: false, code: null, stdout: "" });
    });
  });
}
