import type {
  AgentInfo,
  TerminalId,
  TerminalMetadata,
} from "kolu-common/surface";
import type { TerminalDisplayInfo } from "../../terminal/terminalDisplay";
import type { TileLayout } from "../TileLayout";

/** Live-terminal source row before a presentation-specific order is applied. */
export interface WorkspaceSwitcherSourceEntry {
  id: TerminalId;
  info: TerminalDisplayInfo;
  layout?: TileLayout;
}

/** Pair terminal ids with display info and optional canvas layout. */
export function buildWorkspaceEntries(
  ids: TerminalId[],
  getDisplayInfo: (id: TerminalId) => TerminalDisplayInfo | undefined,
  getLayout?: (id: TerminalId) => TileLayout | undefined,
): WorkspaceSwitcherSourceEntry[] {
  const entries: WorkspaceSwitcherSourceEntry[] = [];
  for (const id of ids) {
    const info = getDisplayInfo(id);
    if (!info) continue;
    entries.push({ id, info, layout: getLayout?.(id) });
  }
  return entries;
}

/** Order entries by recency descending, with canvas (`x`, `y`) as the
 *  secondary key and stable input order as the final tiebreak. Pure — the
 *  recency value is plugged in via the accessor. The expanded panel
 *  re-buckets by agent state, so the visible effect there is
 *  recency-within-bucket. */
export function sortBySwitcherOrder(
  entries: WorkspaceSwitcherSourceEntry[],
  getRecency: (id: TerminalId) => number,
): WorkspaceSwitcherSourceEntry[] {
  return [...entries].sort((a, b) => {
    const ra = getRecency(a.id);
    const rb = getRecency(b.id);
    if (ra !== rb) return rb - ra;
    const ax = a.layout?.x ?? Infinity;
    const bx = b.layout?.x ?? Infinity;
    if (ax !== bx) return ax - bx;
    const ay = a.layout?.y ?? Infinity;
    const by = b.layout?.y ?? Infinity;
    return ay - by;
  });
}

export type WorkspaceAgentBucket = "awaiting" | "working" | "none";

/** Stable agent-state buckets shown as columns in the expanded switcher.
 *
 *  Co-locates each bucket's label, empty-state copy, and full visual
 *  encoding — text color, accent CSS variable for the column rule,
 *  the animated `pill-border-*` class set, and the status glyph used
 *  on cards. Adding or renaming a bucket is a single edit here;
 *  presentation reads from this record rather than re-deriving the
 *  same mapping in each component. */
export const WORKSPACE_AGENT_BUCKETS: readonly {
  key: WorkspaceAgentBucket;
  label: string;
  empty: string;
  textClass: string;
  accentVar: string;
  borderClass: string;
  glyph: string;
}[] = [
  {
    key: "awaiting",
    label: "Awaiting you",
    empty: "No terminals need input",
    textClass: "text-alert",
    accentVar: "var(--color-alert)",
    borderClass: "pill-border pill-border-awaiting",
    glyph: "⏵",
  },
  {
    key: "working",
    label: "Working",
    empty: "No agents are running",
    textClass: "text-accent",
    accentVar: "var(--color-accent)",
    borderClass: "pill-border pill-border-working",
    glyph: "▸",
  },
  {
    key: "none",
    label: "No agent",
    empty: "No plain shells match",
    textClass: "text-fg-3",
    accentVar: "var(--color-fg-3)",
    borderClass: "",
    glyph: "·",
  },
];

/** Searchable live-terminal entry used by the expanded switcher panel. */
export type WorkspaceSwitcherEntry = {
  id: TerminalId;
  repoName: string;
  label: string;
  suffix?: string;
  bucket: WorkspaceAgentBucket;
  info: TerminalDisplayInfo;
  searchText: string;
};

/** Compact row item rendered under a repo heading. */
export type WorkspaceSwitcherCompactItem = {
  id: TerminalId;
  label: string;
  suffix?: string;
  info: TerminalDisplayInfo;
};

/** Repo group used by the collapsed desktop switcher and mobile sheet. */
export type WorkspaceSwitcherRepoGroup = {
  repoName: string;
  color: string;
  items: WorkspaceSwitcherCompactItem[];
};

/** Repo facet derived from the current search result set. */
export type WorkspaceRepoFacet = {
  repoName: string;
  count: number;
  color: string;
};

/** Agent bucket plus the entries currently visible in that column.
 *  `nonStaleCount` is the active subset — entries whose last observed
 *  agent transition is recent enough to count toward the visible badge.
 *  When the model is built without an `isStale` predicate, every entry is
 *  counted as live (so legacy callers see `entries.length`). */
export type WorkspaceSwitcherColumn =
  (typeof WORKSPACE_AGENT_BUCKETS)[number] & {
    entries: WorkspaceSwitcherEntry[];
    nonStaleCount: number;
  };

/** Complete derived model for collapsed and expanded switcher renderers. */
export type WorkspaceSwitcherModel = {
  entries: WorkspaceSwitcherEntry[];
  compactGroups: WorkspaceSwitcherRepoGroup[];
  visibleEntries: WorkspaceSwitcherEntry[];
  selectedRepo: string | null;
  repoFacets: WorkspaceRepoFacet[];
  columns: WorkspaceSwitcherColumn[];
};

/** Classify live agent metadata into the switcher's fixed column set. */
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

/** True when the terminal is currently asking for the user's attention:
 *  agent is in the `awaiting` bucket and the terminal isn't auto-parked
 *  by inactivity. */
export function isAwaitingAttention(
  meta: TerminalMetadata,
  isStale: (lastActivityAt: number) => boolean,
): boolean {
  return (
    agentBucket(meta.agent) === "awaiting" && !isStale(meta.lastActivityAt)
  );
}

const BUCKET_BY_KEY: Record<
  WorkspaceAgentBucket,
  (typeof WORKSPACE_AGENT_BUCKETS)[number]
> = WORKSPACE_AGENT_BUCKETS.reduce(
  (acc, bucket) => {
    acc[bucket.key] = bucket;
    return acc;
  },
  {} as Record<WorkspaceAgentBucket, (typeof WORKSPACE_AGENT_BUCKETS)[number]>,
);

/** Look up a bucket descriptor by its key. Used by presentation code
 *  that has an entry's bucket and needs the matching label/color. */
export function bucketDescriptor(
  bucket: WorkspaceAgentBucket,
): (typeof WORKSPACE_AGENT_BUCKETS)[number] {
  return BUCKET_BY_KEY[bucket];
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

/** Cap on idle (no-agent, non-active) compact pills per repo. Pills that
 *  carry an active agent OR represent the user's active terminal bypass
 *  the cap entirely — both are guaranteed reachable from the pill strip
 *  no matter how many idle peers share the repo. */
const IDLE_PILLS_PER_REPO = 5;

/** Visible-pill count per repo in the collapsed strip. The model uses
 *  this to hoist the active terminal into the visible head when its
 *  natural position would be past the slice boundary, so the renderer
 *  can `slice(0, COMPACT_VISIBLE_PER_REPO)` without re-deriving active
 *  awareness. Single point of enforcement for "active is reachable". */
export const COMPACT_VISIBLE_PER_REPO = 3;

function compactGroupsFor(
  entries: WorkspaceSwitcherEntry[],
  activeId: TerminalId | null,
): WorkspaceSwitcherRepoGroup[] {
  const groups = new Map<string, WorkspaceSwitcherRepoGroup>();
  const idleCounts = new Map<string, number>();
  for (const entry of entries) {
    let group = groups.get(entry.repoName);
    if (!group) {
      group = {
        repoName: entry.repoName,
        color: entry.info.repoColor,
        items: [],
      };
      groups.set(entry.repoName, group);
    }
    // Idle-cap bypass: in-flight agent (salience) or active terminal
    // (reachability). Names kept so a future divergence stays visible.
    const hasAgent = entry.info.meta.agent !== null;
    const isFocused = entry.id === activeId;
    if (!hasAgent && !isFocused) {
      const idle = idleCounts.get(entry.repoName) ?? 0;
      if (idle >= IDLE_PILLS_PER_REPO) continue;
      idleCounts.set(entry.repoName, idle + 1);
    }
    group.items.push({
      id: entry.id,
      label: entry.label,
      suffix: entry.suffix,
      info: entry.info,
    });
  }
  // Hoist active into the visible prefix so `Collapsed.tsx`'s
  // `slice(0, N)` cannot clip a focused-but-not-recent terminal into
  // the `+N` overflow chip.
  if (activeId !== null) {
    for (const group of groups.values()) {
      const idx = group.items.findIndex((item) => item.id === activeId);
      if (idx >= COMPACT_VISIBLE_PER_REPO) {
        // biome-ignore lint/style/noNonNullAssertion: idx came from findIndex on the same array, splice always yields the element.
        const active = group.items.splice(idx, 1)[0]!;
        group.items.splice(COMPACT_VISIBLE_PER_REPO - 1, 0, active);
      }
    }
  }
  // Stable repo slot via alphabetical; intra-repo recency comes from
  // input order (set upstream by `sortBySwitcherOrder`).
  return [...groups.values()].sort((a, b) =>
    a.repoName.localeCompare(b.repoName),
  );
}

/** Derive all switcher projections (search, facets, bucket columns,
 *  compact groups) from one live-terminal entry list. Owns the ordering
 *  pipeline — when `getRecency` is provided, applies `sortBySwitcherOrder`
 *  internally so callers can't feed unsorted entries into the grouping.
 *  When `isStale` is provided, each column's `nonStaleCount` excludes
 *  parked-by-inactivity entries; otherwise every entry counts as live. */
export function buildWorkspaceSwitcherModel(
  sources: WorkspaceSwitcherSourceEntry[],
  options: {
    query?: string;
    repoFilter?: string | null;
    activeId?: TerminalId | null;
    getRecency?: (id: TerminalId) => number;
    isStale?: (lastActivityAt: number) => boolean;
  } = {},
): WorkspaceSwitcherModel {
  const ordered = options.getRecency
    ? sortBySwitcherOrder(sources, options.getRecency)
    : sources;
  const entries: WorkspaceSwitcherEntry[] = ordered.map((source) => {
    const base = {
      id: source.id,
      repoName: source.info.key.group,
      label: source.info.key.label,
      suffix: source.info.key.suffix,
      bucket: agentBucket(source.info.meta.agent),
      info: source.info,
    };
    return {
      ...base,
      searchText: searchTextFor(base),
    };
  });

  const { repoFacets, selectedRepo, visibleEntries } = searchResults(
    entries,
    options.query ?? "",
    options.repoFilter ?? null,
  );

  const isStale = options.isStale;
  const columns = WORKSPACE_AGENT_BUCKETS.map((bucket) => {
    const bucketEntries = visibleEntries.filter(
      (entry) => entry.bucket === bucket.key,
    );
    const nonStaleCount = isStale
      ? bucketEntries.reduce(
          (n, entry) => (isStale(entry.info.meta.lastActivityAt) ? n : n + 1),
          0,
        )
      : bucketEntries.length;
    return { ...bucket, entries: bucketEntries, nonStaleCount };
  });

  return {
    entries,
    compactGroups: compactGroupsFor(entries, options.activeId ?? null),
    visibleEntries,
    selectedRepo,
    repoFacets,
    columns,
  };
}

/** Filter, facet, and repo-narrow in one shot. Bundling the three
 *  results makes the dependency explicit: facets count *pre*-repo-
 *  filter matches (so the user can see how many entries would appear
 *  in each repo), `visibleEntries` count *post*-filter (only the
 *  selected repo). Splitting them across separate locals invited a
 *  silent reordering bug. */
function searchResults(
  entries: WorkspaceSwitcherEntry[],
  query: string,
  repoFilter: string | null,
): {
  repoFacets: WorkspaceRepoFacet[];
  selectedRepo: string | null;
  visibleEntries: WorkspaceSwitcherEntry[];
} {
  const tokens = queryTokens(query);
  const queryMatches =
    tokens.length === 0
      ? entries
      : entries.filter((entry) => matchesQuery(entry, tokens));

  const facetCounts = new Map<string, { count: number; color: string }>();
  for (const entry of queryMatches) {
    const facet = facetCounts.get(entry.repoName);
    if (facet) {
      facet.count += 1;
    } else {
      facetCounts.set(entry.repoName, {
        count: 1,
        color: entry.info.repoColor,
      });
    }
  }
  const repoFacets = [...facetCounts.entries()].map(
    ([repoName, { count, color }]) => ({
      repoName,
      count,
      color,
    }),
  );

  const selectedRepo =
    repoFilter && facetCounts.has(repoFilter) ? repoFilter : null;
  const visibleEntries = selectedRepo
    ? queryMatches.filter((entry) => entry.repoName === selectedRepo)
    : queryMatches;

  return { repoFacets, selectedRepo, visibleEntries };
}
