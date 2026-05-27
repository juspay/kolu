/**
 * Local-store-copy provisioning for the remote agent.
 *
 * The plan's row 8 trade-off, inverted: by building the agent's closure
 * locally and `nix copy`-ing it to the remote, parent and agent are
 * always the same nix derivation. Wire-shape drift is impossible by
 * construction. (R-2 uses a flake-ref env var because parent and agent
 * can be operated by different humans on different cadences; this demo
 * sidesteps that problem entirely.)
 *
 * Workflow:
 *
 *   1. `agentPath = nix build .#process-monitor-agent --print-out-paths`
 *      (cached after first invocation; cheap on warm builds).
 *   2. `ssh $host stat $agentPath` — does the remote already have it?
 *      If so, skip the copy.
 *   3. `nix copy --to ssh-ng://$host $agentPath` — push the closure.
 *      Progress lines go to stderr; we forward them to the consumer.
 *
 * Localhost (`ssh localhost ...`) is a fully valid target — the same
 * closure path exists locally, the `stat` succeeds, the copy step is
 * skipped, and the ssh spawn just re-execs `$agentPath/bin/...` in a
 * subshell. R-1.5 verifies on `localhost`; second-host verification is
 * documentation polish.
 *
 * Override hooks for tests / local dev:
 *
 *   - `AGENT_PATH` env var (or `--agent-path <path>` flag in `main.ts`)
 *     skips the `nix build` step and uses the supplied path directly.
 *     Convenient for `pnpm dev` cycles where you want to iterate on the
 *     agent in-tree without rebuilding the closure each save.
 */

import { spawn } from "node:child_process";

export interface ProvisionOptions {
  host: string;
  agentPath: string;
  onProgress: (line: string) => void;
}

export interface ProvisionResult {
  ok: boolean;
  /** Reason for failure, surfaced to the UI's disconnected overlay.
   *  `undefined` on success. */
  reason?: string;
}

/** Returns true if `$host` already has `$agentPath` in its nix store
 *  (or local filesystem — `localhost` triggers a vacuous true). Tries
 *  `ssh $host test -e $path` and returns the exit status as a boolean.
 *
 *  Implementation detail: uses `BatchMode=yes` so a missing key turns
 *  into an immediate failure rather than a 30-second TTY prompt block. */
export async function isAgentPresent(
  host: string,
  agentPath: string,
): Promise<boolean> {
  return new Promise<boolean>((resolve) => {
    const proc = spawn(
      "ssh",
      ["-o", "BatchMode=yes", host, "test", "-e", agentPath],
      { stdio: "ignore" },
    );
    proc.on("exit", (code) => resolve(code === 0));
    proc.on("error", () => resolve(false));
  });
}

/** Push the agent closure to `$host` via `nix copy`. Forwards stderr
 *  progress to `onProgress` so the parent can stream it to the browser.
 *
 *  Resolves with `{ ok: true }` on a clean exit; `{ ok: false, reason }`
 *  on any failure (the reason is surfaced to the disconnected overlay,
 *  not silently swallowed). */
export async function provisionAgent(
  opts: ProvisionOptions,
): Promise<ProvisionResult> {
  // Localhost shortcut — the closure is already in /nix/store; copy is
  // a no-op. Saves a `nix-store --query` roundtrip.
  if (opts.host === "localhost" || opts.host === "127.0.0.1") {
    opts.onProgress("localhost: closure already in local store; skipping copy");
    return { ok: true };
  }

  if (await isAgentPresent(opts.host, opts.agentPath)) {
    opts.onProgress(
      `${opts.host}: agent closure already present; skipping copy`,
    );
    return { ok: true };
  }

  opts.onProgress(`${opts.host}: copying agent closure via nix copy…`);
  return new Promise<ProvisionResult>((resolve) => {
    const proc = spawn(
      "nix",
      ["copy", "--to", `ssh-ng://${opts.host}`, opts.agentPath],
      { stdio: ["ignore", "pipe", "pipe"] },
    );
    proc.stderr?.setEncoding("utf-8");
    proc.stderr?.on("data", (chunk: string) => {
      for (const line of chunk.split("\n")) {
        if (line.trim().length > 0) opts.onProgress(line);
      }
    });
    proc.on("exit", (code) => {
      if (code === 0) {
        opts.onProgress(`${opts.host}: nix copy complete`);
        resolve({ ok: true });
      } else {
        resolve({
          ok: false,
          reason: `nix copy exited with code ${code}`,
        });
      }
    });
    proc.on("error", (err) => {
      resolve({
        ok: false,
        reason: `nix copy failed to spawn: ${err.message}`,
      });
    });
  });
}

/** Resolve the agent's nix store path. Honours `AGENT_PATH` env var or
 *  builds via `nix build .#process-monitor-agent` from the repo root.
 *
 *  Returns `null` on failure (e.g. running outside a nix flake — the
 *  parent server still boots; the UI shows a permanent "configure
 *  AGENT_PATH" disconnected message). */
export async function resolveAgentPath(
  flakeRef: string,
): Promise<string | null> {
  const envPath = process.env.AGENT_PATH;
  if (envPath !== undefined && envPath.length > 0) return envPath;
  return new Promise<string | null>((resolve) => {
    const proc = spawn(
      "nix",
      [
        "build",
        flakeRef,
        "--no-link",
        "--print-out-paths",
        "--accept-flake-config",
      ],
      { stdio: ["ignore", "pipe", "pipe"] },
    );
    let stdout = "";
    proc.stdout?.setEncoding("utf-8");
    proc.stdout?.on("data", (chunk: string) => {
      stdout += chunk;
    });
    proc.on("exit", (code) => {
      if (code === 0) resolve(stdout.trim());
      else resolve(null);
    });
    proc.on("error", () => resolve(null));
  });
}
