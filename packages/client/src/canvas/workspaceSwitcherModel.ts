import type { AgentInfo, TerminalId } from "kolu-common/surface";
import type { TerminalDisplayInfo } from "../terminal/terminalDisplay";
import type { WorkspaceSwitcherRepoGroup } from "./workspaceSwitcherOrder";

export type WorkspaceAgentBucket = "awaiting" | "working" | "none";

export const WORKSPACE_AGENT_BUCKETS: readonly {
  key: WorkspaceAgentBucket;
  label: string;
  empty: string;
}[] = [
  {
    key: "awaiting",
    label: "Awaiting you",
    empty: "No terminals need input",
  },
  {
    key: "working",
    label: "Working",
    empty: "No agents are running",
  },
  {
    key: "none",
    label: "No agent",
    empty: "No plain shells match",
  },
];

export type WorkspaceSwitcherEntry = {
  id: TerminalId;
  repoName: string;
  label: string;
  suffix?: string;
  bucket: WorkspaceAgentBucket;
  info: TerminalDisplayInfo;
  searchText: string;
};

export type WorkspaceRepoFacet = {
  repoName: string;
  count: number;
};

export type WorkspaceSwitcherColumn = {
  key: WorkspaceAgentBucket;
  label: string;
  empty: string;
  entries: WorkspaceSwitcherEntry[];
};

export type WorkspaceSwitcherModel = {
  entries: WorkspaceSwitcherEntry[];
  visibleEntries: WorkspaceSwitcherEntry[];
  repoFacets: WorkspaceRepoFacet[];
  columns: WorkspaceSwitcherColumn[];
};

export function agentBucket(
  agent: AgentInfo | null | undefined,
): WorkspaceAgentBucket {
  switch (agent?.state) {
    case "waiting":
      return "awaiting";
    case "thinking":
    case "tool_use":
      return "working";
    case undefined:
      return "none";
  }
}

function add(values: string[], value: unknown): void {
  if (value === null || value === undefined) return;
  values.push(String(value));
}

function prSearchFields(info: TerminalDisplayInfo): string[] {
  const pr = info.meta.pr;
  switch (pr.kind) {
    case "ok":
      return [
        pr.kind,
        pr.value.number.toString(),
        pr.value.title,
        pr.value.url,
        pr.value.state,
        pr.value.checks ?? "",
      ];
    case "unavailable":
      return [pr.kind, pr.source.provider, pr.source.code];
    case "absent":
    case "pending":
      return [pr.kind];
  }
}

function searchTextFor(entry: {
  repoName: string;
  label: string;
  suffix?: string;
  info: TerminalDisplayInfo;
}): string {
  const { info } = entry;
  const git = info.meta.git;
  const fg = info.meta.foreground;
  const agent = info.meta.agent;
  const values: string[] = [
    entry.repoName,
    entry.label,
    info.key.group,
    info.key.label,
    ...prSearchFields(info),
  ];

  add(values, entry.suffix);
  add(values, info.meta.cwd);
  add(values, info.meta.lastAgentCommand);
  add(values, git?.repoRoot);
  add(values, git?.repoName);
  add(values, git?.worktreePath);
  add(values, git?.branch);
  add(values, git?.mainRepoRoot);
  add(values, fg?.name);
  add(values, fg?.title);
  add(values, agent?.kind);
  add(values, agent?.state);
  add(values, agent?.sessionId);
  add(values, agent?.model);
  add(values, agent?.summary);
  add(values, agent?.contextTokens);
  add(values, agent?.taskProgress?.completed);
  add(values, agent?.taskProgress?.total);

  return values.join(" ").toLowerCase();
}

function queryTokens(query: string): string[] {
  return query.toLowerCase().trim().split(/\s+/).filter(Boolean);
}

function matchesQuery(
  entry: WorkspaceSwitcherEntry,
  tokens: string[],
): boolean {
  return tokens.every((token) => entry.searchText.includes(token));
}

export function buildWorkspaceSwitcherModel(
  groups: WorkspaceSwitcherRepoGroup[],
  getDisplayInfo: (id: TerminalId) => TerminalDisplayInfo | undefined,
  options: {
    query?: string;
    repoFilter?: string | null;
  } = {},
): WorkspaceSwitcherModel {
  const entries: WorkspaceSwitcherEntry[] = [];
  for (const group of groups) {
    for (const item of group.items) {
      const info = getDisplayInfo(item.id);
      if (!info) continue;
      const base = {
        id: item.id,
        repoName: group.repoName,
        label: item.label,
        suffix: item.suffix,
        bucket: agentBucket(info.meta.agent),
        info,
      };
      entries.push({
        ...base,
        searchText: searchTextFor(base),
      });
    }
  }

  const tokens = queryTokens(options.query ?? "");
  const queryMatches =
    tokens.length === 0
      ? entries
      : entries.filter((entry) => matchesQuery(entry, tokens));

  const facetCounts = new Map<string, number>();
  for (const entry of queryMatches) {
    facetCounts.set(entry.repoName, (facetCounts.get(entry.repoName) ?? 0) + 1);
  }
  const repoFacets = [...facetCounts.entries()].map(([repoName, count]) => ({
    repoName,
    count,
  }));

  const visibleEntries = options.repoFilter
    ? queryMatches.filter((entry) => entry.repoName === options.repoFilter)
    : queryMatches;

  const columns = WORKSPACE_AGENT_BUCKETS.map((bucket) => ({
    ...bucket,
    entries: visibleEntries.filter((entry) => entry.bucket === bucket.key),
  }));

  return {
    entries,
    visibleEntries,
    repoFacets,
    columns,
  };
}
