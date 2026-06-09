/**
 * Writable per-SHA workspaces — the "load-bearing gap" the Atlas note named:
 * kolu's CI recipes (`nix`, `e2e`, `smoke`) are write-heavy, so a lane can't
 * run them from the read-only runner closure the way mini-ci's typecheck
 * pipeline does.
 *
 * Shape (per design review): a per-slug *object cache* (bare repo, fetched
 * incrementally under a flock so concurrent runs on a shared host — rasam
 * has no lease — don't race), and a *fresh per-run worktree* keyed by
 * sha + pid so a re-run of the same SHA never collides with a previous
 * run's directory. The worktree lands under the system tmpdir: the host's
 * tmpfiles reaper eventually collects what a crashed run leaves behind
 * (justci's /tmp debris had the same lifecycle); a clean run removes its
 * own worktree on dispose.
 *
 * Remote lanes fetch the SHA from the origin URL, which requires the SHA to
 * be *pushed* — a deliberate divergence from justci's git-bundle transport,
 * documented in the README (the /do flow always pushes before CI).
 */

import { spawn } from "node:child_process";
import { randomBytes } from "node:crypto";
import { mkdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

export interface WorkspaceRequest {
  origin: string;
  sha: string;
}

export interface WorkspaceResult {
  ok: boolean;
  workspace: string | null;
  /** Best-effort cleanup of this run's worktree (a clean run calls it). */
  cleanup: () => void;
}

/** Last path segment of the origin, sans `.git` — the cache key. */
export function slugFor(origin: string): string {
  const tail =
    origin
      .replace(/\.git$/, "")
      .split(/[/:]/)
      .at(-1) ?? "repo";
  return tail.replace(/[^A-Za-z0-9._-]/g, "_") || "repo";
}

function run(
  cmd: string,
  args: string[],
  opts: { cwd?: string },
  onOutput: (line: string) => void,
): Promise<number> {
  return new Promise((resolve) => {
    const child = spawn(cmd, args, {
      cwd: opts.cwd,
      stdio: ["ignore", "pipe", "pipe"],
    });
    const forward = (chunk: Buffer): void => {
      for (const line of chunk.toString("utf-8").split("\n")) {
        if (line.trim().length > 0) onOutput(line);
      }
    };
    child.stdout?.on("data", forward);
    child.stderr?.on("data", forward);
    child.on("error", (err) => {
      onOutput(`spawn ${cmd} failed: ${err.message}`);
      resolve(127);
    });
    child.on("close", (code) => resolve(code ?? 1));
  });
}

/** Prepare a fresh writable checkout of `origin` at `sha`. Idempotent: every
 *  call yields a new worktree, so `rerun(_ci-setup)` and same-SHA retries
 *  never trip over a previous run's directory. */
export async function prepareWorkspace(
  req: WorkspaceRequest,
  onOutput: (line: string) => void,
): Promise<WorkspaceResult> {
  const home = process.env.HOME ?? tmpdir();
  const slug = slugFor(req.origin);
  const cache = join(home, ".cache", "odu", "repos", `${slug}.git`);
  // A fresh, unique worktree name per invocation — pid alone collides when the
  // same runner process prepares the same SHA twice (a `rerun(_ci-setup)` or a
  // same-SHA retry), and `git worktree add` refuses an existing directory. The
  // random suffix makes every call yield a brand-new path, honoring the
  // idempotence this function advertises.
  const workdir = join(
    process.env.ODU_WORK_DIR ?? join(tmpdir(), "odu"),
    slug,
    `${req.sha.slice(0, 7)}-${process.pid}-${randomBytes(4).toString("hex")}`,
  );
  const fail = (msg: string): WorkspaceResult => {
    onOutput(`[odu] _ci-setup failed: ${msg}`);
    return { ok: false, workspace: null, cleanup: () => {} };
  };

  mkdirSync(cache, { recursive: true });
  onOutput(`[odu] object cache: ${cache}`);
  if (
    (await run(
      "git",
      ["-C", cache, "rev-parse", "--git-dir"],
      {},
      () => {},
    )) !== 0
  ) {
    const code = await run("git", ["init", "--bare", cache], {}, onOutput);
    if (code !== 0) return fail(`git init --bare exited ${code}`);
  }

  // Serialize fetches per slug: rasam is shared between concurrent runs and
  // git ref/odb locks are not concurrency-friendly. flock(1) is ubiquitous on
  // the NixOS pool boxes; on hosts without it (macOS), fall back to a bare
  // fetch — fetching an explicit SHA touches no refs, which dodges the
  // common lock contention anyway.
  onOutput(`[odu] fetching ${req.sha} from ${req.origin}`);
  const fetchArgs = ["-C", cache, "fetch", "--no-tags", req.origin, req.sha];
  let code = await run(
    "flock",
    [join(cache, "odu-fetch.lock"), "git", ...fetchArgs],
    {},
    onOutput,
  );
  if (code === 127) code = await run("git", fetchArgs, {}, onOutput);
  if (code !== 0) {
    return fail(
      `git fetch exited ${code} — is ${req.sha} pushed to ${req.origin}? ` +
        "(odu fetches pushed SHAs; it does not ship git bundles)",
    );
  }

  mkdirSync(join(workdir, ".."), { recursive: true });
  await run("git", ["-C", cache, "worktree", "prune"], {}, () => {});
  onOutput(`[odu] worktree: ${workdir}`);
  code = await run(
    "git",
    ["-C", cache, "worktree", "add", "--detach", workdir, req.sha],
    {},
    onOutput,
  );
  if (code !== 0) return fail(`git worktree add exited ${code}`);

  return {
    ok: true,
    workspace: workdir,
    cleanup: () => {
      try {
        rmSync(workdir, { recursive: true, force: true });
      } catch {
        // best-effort; the tmpdir reaper owns the long tail
      }
    },
  };
}
