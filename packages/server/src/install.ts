/**
 * Agent installation — ship the kolu binary to a remote SSH host via
 * `nix copy`.
 *
 * Plan B's pivot for binary shipping: the remote already has Nix
 * (kolu's entire user base does — that's how they got kolu), so
 * shipping the agent reduces to:
 *
 *   nix copy --to ssh://$host .#kolu
 *
 * Nix handles arch resolution, closure transfer, content-addressed
 * dedup, and verification. Replaces Zed's three-strategy
 * `ensure_server_binary` dance with one nix call.
 *
 * **Pre-implementation review finding G**: `nix copy` of the local-arch
 * store path to a different-arch remote SILENTLY FAILS (substitution
 * misses). We detect the remote system first and either build for that
 * system locally (`nix build --system <remote-system>`) or fail with an
 * explicit error if cross-compilation isn't available. The prototype
 * implements the detection + explicit error path; cross-system build is
 * a TODO for R-3.
 */

import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { log } from "./log.ts";

const execFileP = promisify(execFile);

/** Run `ssh $host nix eval --raw --impure --expr 'builtins.currentSystem'`
 *  to learn the remote's nix system tuple. */
async function probeRemoteSystem(host: string): Promise<string> {
  const { stdout } = await execFileP("ssh", [
    host,
    "nix",
    "eval",
    "--raw",
    "--impure",
    "--expr",
    "builtins.currentSystem",
  ]);
  return stdout.trim();
}

/** Local nix system (e.g. `x86_64-linux`, `aarch64-darwin`). */
async function localSystem(): Promise<string> {
  const { stdout } = await execFileP("nix", [
    "eval",
    "--raw",
    "--impure",
    "--expr",
    "builtins.currentSystem",
  ]);
  return stdout.trim();
}

/** Probe whether `storePath` is already realised on the remote — skip
 *  the copy if so. A non-zero exit from `nix-store --query` means the
 *  path is absent; any other error (SSH unreachable, auth failure) is
 *  logged and treated as "not realised" so the caller proceeds to
 *  `nix copy`, which will surface the real error. */
async function isPathRealisedOnRemote(
  host: string,
  storePath: string,
): Promise<boolean> {
  try {
    await execFileP("ssh", [
      host,
      "nix-store",
      "--query",
      "--requisites",
      storePath,
    ]);
    return true;
  } catch (err) {
    log.warn(
      { host, storePath, err },
      "isPathRealisedOnRemote: probe failed, treating as not realised",
    );
    return false;
  }
}

/** Resolve the running kolu binary's store path. The wrapper sets
 *  `KOLU_STORE_PATH` at install time, or we fall back to `nix eval`
 *  on the flake's `.#kolu` attribute. */
async function getKoluStorePath(): Promise<string> {
  const envHint = process.env.KOLU_STORE_PATH;
  if (envHint) return envHint;
  // Fallback: build the flake and read the store path.
  const { stdout } = await execFileP("nix", ["eval", "--raw", ".#kolu"]);
  return stdout.trim();
}

/**
 * Install the kolu agent on `host`. Idempotent — if the store path is
 * already realised on the remote, returns early.
 *
 * For cross-arch (local x86_64-linux ↔ remote aarch64-darwin), the
 * caller's local `.#kolu` derivation isn't valid on the remote's
 * system. The prototype detects this and throws `CrossArchUnsupported`
 * with a clear message; R-3 will add `nix build .#packages.<remoteSystem>.kolu`
 * before copying.
 */
export async function installAgent(host: string): Promise<void> {
  const [remoteSystem, lSystem] = await Promise.all([
    probeRemoteSystem(host).catch(() => {
      throw new Error(
        `installAgent(${host}): could not probe remote nix system. ` +
          `Is Nix installed on the remote? Plan B assumes Nix-on-remote.`,
      );
    }),
    localSystem(),
  ]);

  if (remoteSystem !== lSystem) {
    throw new Error(
      `installAgent(${host}): cross-system not yet implemented (R-3). ` +
        `Local: ${lSystem}, remote: ${remoteSystem}. Build the remote-system ` +
        `derivation locally first: nix build .#packages.${remoteSystem}.kolu`,
    );
  }

  const storePath = await getKoluStorePath();
  log.info(
    { host, storePath, system: lSystem },
    "installAgent: probing remote",
  );

  if (await isPathRealisedOnRemote(host, storePath)) {
    log.info({ host, storePath }, "installAgent: already realised, skipping");
    return;
  }

  log.info({ host, storePath }, "installAgent: nix copy");
  await execFileP("nix", ["copy", "--to", `ssh://${host}`, storePath]);
  log.info({ host, storePath }, "installAgent: done");
}

/** Build the remote command that runs `kolu agent --stdio` from the
 *  copied store path. Used by `HostSession` when spawning the ssh
 *  subprocess. */
export async function remoteAgentCommand(host: string): Promise<string[]> {
  const storePath = await getKoluStorePath();
  return ["ssh", host, `${storePath}/bin/kolu`, "agent", "--stdio"];
}
