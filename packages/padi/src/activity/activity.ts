import fs from "node:fs";
import type {
  ActivityFeed,
  RecentAgent,
  RecentRepo,
} from "@kolu/padi-client/surface";
import { AGENT_CLI, stableFlagTokens } from "kolu-agents/vocab";
import { log } from "../log.ts";
import { padiSurfaceCtx } from "../padiSurfaceCtx.ts";

const MAX_RECENT_REPOS = 20;
const MAX_RECENT_AGENTS = 10;

function existsOnDisk(path: string): boolean {
  try {
    fs.accessSync(path);
    return true;
  } catch {
    return false;
  }
}

function withMruUpsert<T>(
  list: readonly T[],
  item: T,
  keyOf: (t: T) => string,
  timeOf: (t: T) => number,
  max: number,
): T[] {
  const key = keyOf(item);
  const next = [...list];
  const idx = next.findIndex((x) => keyOf(x) === key);
  if (idx !== -1) next[idx] = item;
  else next.push(item);
  next.sort((a, b) => timeOf(b) - timeOf(a));
  return next.slice(0, max);
}

function getRecentRepos(): readonly RecentRepo[] {
  const feed = padiSurfaceCtx.cells.activityFeed.get();
  const live = feed.recentRepos.filter((r) => existsOnDisk(r.repoRoot));
  if (live.length < feed.recentRepos.length) {
    padiSurfaceCtx.cells.activityFeed.set({ ...feed, recentRepos: live });
  }
  return live;
}

/** Get the full activity feed snapshot. */
export function getActivityFeed(): ActivityFeed {
  return {
    recentRepos: getRecentRepos(),
    recentAgents: padiSurfaceCtx.cells.activityFeed.get().recentAgents,
  };
}

/** Upsert a repo into the recent repos list and publish. */
export function trackRecentRepo(repoRoot: string, repoName: string): void {
  const feed = padiSurfaceCtx.cells.activityFeed.get();
  const next = withMruUpsert(
    feed.recentRepos,
    { repoRoot, repoName, lastSeen: Date.now() },
    (r) => r.repoRoot,
    (r) => r.lastSeen,
    MAX_RECENT_REPOS,
  );
  padiSurfaceCtx.cells.activityFeed.set({ ...feed, recentRepos: next });
}

function recentAgentKey(agent: Pick<RecentAgent, "kind" | "argv">): string {
  const vocab = AGENT_CLI.byKind(agent.kind);
  const flags =
    vocab === undefined ? agent.argv : stableFlagTokens(vocab.cli, agent.argv);
  return `${agent.kind}\u0000${flags.join("\u0000")}`;
}

export function trackRecentAgent(
  kind: string,
  argv: readonly string[],
  { replacePlaceholder = false }: { replacePlaceholder?: boolean } = {},
): void {
  const vocab = AGENT_CLI.byKind(kind);
  const flags =
    vocab === undefined ? [...argv] : stableFlagTokens(vocab.cli, argv);
  const feed = padiSurfaceCtx.cells.activityFeed.get();
  const rows =
    replacePlaceholder && flags.length > 0
      ? feed.recentAgents.filter(
          (row) => !(row.kind === kind && row.argv.length === 0),
        )
      : feed.recentAgents;
  const next = withMruUpsert(
    rows,
    { kind, argv: flags, lastSeen: Date.now() },
    recentAgentKey,
    (a) => a.lastSeen,
    MAX_RECENT_AGENTS,
  );
  padiSurfaceCtx.cells.activityFeed.set({ ...feed, recentAgents: next });
  log.info({ kind, argv: flags, total: next.length }, "recent agent tracked");
}
