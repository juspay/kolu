/**
 * GitHub commit statuses — byte-compatible with what justci posted, so
 * kolu's branch protection is satisfied without touching its required
 * contexts (decomposed from live API data on merged PRs):
 *
 *   context      ci::<recipe>@<platform>     (setup: _ci-setup@<platform>)
 *   description  Running: <log> | Succeeded (<dur>): <log> | Failed (<dur>): <log>
 *   log path     .ci/<sha7>/<platform>/<context-prefix>.log
 *   target_url   never set
 *
 * `Errored (<dur>): <log>` (GitHub state `error`) is odu's own addition for
 * infrastructure death — justci's wording for that case was never observed
 * in the wild, so this is a decision, not parity.
 *
 * Posts go through `gh api` (the `$ODU_GH_BIN` override is baked to the
 * pinned gh in the nix wrapper) from the coordinator only — lane hosts never
 * see credentials. Posting is diff-driven off the fan-in state: after any
 * gap, the next snapshot re-derives exactly the transitions that were
 * missed. Failures to post are logged, retried once, and never fail the run.
 */

import { spawn } from "node:child_process";
import { formatGoDuration } from "../common/duration";
import { splitFanId } from "../common/nodeId";
import {
  type GithubState,
  type NodeStatus,
  STATUS_META,
} from "../common/surface";

export type { GithubState };

/** `ci::e2e@x86_64-linux` → `.ci/<sha7>/x86_64-linux/ci::e2e.log` */
export function logPathFor(sha7: string, nodeId: string): string {
  const { namepath, platform } = splitFanId(nodeId);
  return `.ci/${sha7}/${platform}/${namepath}.log`;
}

export interface StatusPayload {
  state: GithubState;
  context: string;
  description: string;
}

/** The status to post for a node transition; `null` = nothing to post
 *  (pending resets and skips post nothing — a skipped required context stays
 *  absent and correctly blocks the merge, as observed under justci). */
export function statusFor(
  nodeId: string,
  status: NodeStatus,
  durationMs: number | null,
  sha7: string,
): StatusPayload | null {
  // The state + the post/no-post decision come from the shared projection;
  // only the justci wording (with duration) is assembled locally.
  const state = STATUS_META[status].github;
  if (state === null) return null;
  const log = logPathFor(sha7, nodeId);
  const dur = formatGoDuration(durationMs ?? 0);
  const description =
    status === "running"
      ? `Running: ${log}`
      : status === "ok"
        ? `Succeeded (${dur}): ${log}`
        : status === "failed"
          ? `Failed (${dur}): ${log}`
          : `Errored (${dur}): ${log}`;
  return { state, context: nodeId, description };
}

export interface StatusPosterOptions {
  owner: string;
  repo: string;
  sha: string;
  enabled: boolean;
  onLine: (line: string) => void;
}

export class StatusPoster {
  private readonly lastPosted = new Map<string, string>();
  private queue: Promise<void> = Promise.resolve();

  constructor(private readonly opts: StatusPosterOptions) {}

  /** Post the payload unless this exact (context, state, description) was the
   *  last thing posted for the context — diffing snapshots makes redelivery
   *  of the same terminal state common and harmless. */
  post(payload: StatusPayload): void {
    if (!this.opts.enabled) return;
    const key = `${payload.state}\0${payload.description}`;
    if (this.lastPosted.get(payload.context) === key) return;
    this.lastPosted.set(payload.context, key);
    this.queue = this.queue.then(() => this.send(payload, 2));
  }

  /** Contexts whose last post was `Running:` — the finalizer's worklist. */
  pendingContexts(): string[] {
    return [...this.lastPosted.entries()]
      .filter(([, key]) => key.startsWith("pending\0"))
      .map(([context]) => context);
  }

  /** Wait for the post queue to drain (call before process exit). */
  settle(): Promise<void> {
    return this.queue;
  }

  private send(payload: StatusPayload, attempts: number): Promise<void> {
    return new Promise((resolve) => {
      const gh = process.env.ODU_GH_BIN ?? "gh";
      const child = spawn(
        gh,
        [
          "api",
          `repos/${this.opts.owner}/${this.opts.repo}/statuses/${this.opts.sha}`,
          "-f",
          `state=${payload.state}`,
          "-f",
          `context=${payload.context}`,
          "-f",
          `description=${payload.description}`,
        ],
        { stdio: ["ignore", "ignore", "pipe"] },
      );
      let stderr = "";
      child.stderr?.on("data", (chunk: Buffer) => {
        stderr += chunk.toString("utf-8");
      });
      const fail = (why: string): void => {
        if (attempts > 1) {
          void this.send(payload, attempts - 1).then(resolve);
          return;
        }
        this.opts.onLine(
          `[odu] status post failed for ${payload.context}: ${why.trim()}`,
        );
        resolve();
      };
      child.on("error", (err) => fail(err.message));
      child.on("close", (code) => {
        if (code === 0) resolve();
        else fail(stderr || `gh exited ${code}`);
      });
    });
  }
}

/** Parse `git remote get-url origin` output into {owner, repo} for the
 *  statuses API; understands https and ssh GitHub remotes. */
export function parseGithubRemote(
  url: string,
): { owner: string; repo: string } | null {
  const match =
    /github\.com[/:]([^/]+)\/([^/]+?)(?:\.git)?$/.exec(url.trim()) ?? null;
  if (match === null) return null;
  const [, owner, repo] = match;
  if (owner === undefined || repo === undefined) return null;
  return { owner, repo };
}

/** Normalize a GitHub remote to the anonymous-https form lane hosts fetch
 *  from (they have no GitHub ssh identity — the repo being public is what
 *  makes remote lanes work). */
export function fetchUrlFor(url: string): string {
  const gh = parseGithubRemote(url);
  if (gh === null) return url.trim();
  return `https://github.com/${gh.owner}/${gh.repo}`;
}
