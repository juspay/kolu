import type { AgentInfo, TerminalId } from "kolu-common/surface";
import {
  type IdleBucket,
  IDLE_BUCKETS,
  type IdleBucketKey,
} from "../../terminal/activityWindow";
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

export type WorkspaceAgentBucket = "awaiting" | "working" | "idle" | "none";

/** Stable agent-state buckets shown as columns in the expanded switcher.
 *
 *  Co-locates each bucket's label, empty-state copy, and full visual
 *  encoding — text color, accent CSS variable for the column rule,
 *  the animated `pill-border-*` class set, and the status glyph used
 *  on cards. Adding or renaming a bucket is a single edit here;
 *  presentation reads from this record rather than re-deriving the
 *  same mapping in each component.
 *
 *  Idle leads the row — it's the triage column the user opens the
 *  switcher to scan first. Then live attention (Awaiting, Working),
 *  with "No agent" trailing as the narrow plain-shells bucket
 *  (`lastActivityAt === 0`, never hosted an agent). */
export const WORKSPACE_AGENT_BUCKETS = [
  {
    key: "idle",
    label: "Idle",
    empty: "No parked terminals",
    textClass: "text-fg-3",
    accentVar: "var(--color-fg-3)",
    borderClass: "",
    // Crescent moon — same vocabulary as the minimap's parked tiles.
    glyph: "☾",
  },
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
] as const satisfies readonly {
  key: WorkspaceAgentBucket;
  label: string;
  empty: string;
  textClass: string;
  accentVar: string;
  borderClass: string;
  glyph: string;
}[];

type WorkspaceSwitcherEntryBase = {
  id: TerminalId;
  repoName: string;
  label: string;
  suffix?: string;
  info: TerminalDisplayInfo;
  searchText: string;
};

/** Searchable live-terminal entry. Discriminated on `bucket`: only the
 *  Idle arm carries `idleSub`, so a consumer that narrows on
 *  `entry.bucket === "idle"` reads the sub-bucket key without an
 *  optional dance — and a non-idle entry cannot accidentally carry one. */
export type WorkspaceSwitcherEntry =
  | (WorkspaceSwitcherEntryBase & {
      bucket: "idle";
      idleSub: IdleBucketKey;
    })
  | (WorkspaceSwitcherEntryBase & {
      bucket: Exclude<WorkspaceAgentBucket, "idle">;
    });

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

/** Idle column sub-row. Empty buckets stay in the array so the column
 *  always shows the full ladder (4–12h, 12–24h, 24–48h, 48h+) — empty
 *  ranges read as a positive signal ("nothing parked here yet"). */
export type WorkspaceSwitcherIdleSubBucket = IdleBucket & {
  entries: WorkspaceSwitcherEntry[];
};

/** Bucket descriptor narrowed to a specific column key — preserves the
 *  per-key invariant in the descriptor table (label, glyph, etc.) so the
 *  discriminated `WorkspaceSwitcherColumn` arms below stay tight to
 *  their own descriptor row. */
type DescriptorFor<K extends WorkspaceAgentBucket> = Extract<
  (typeof WORKSPACE_AGENT_BUCKETS)[number],
  { key: K }
>;

/** Agent bucket plus the entries currently visible in that column.
 *
 *  Discriminated on `key`: only the Idle arm carries `idleSubBuckets`
 *  (always populated, always the full 4-rung ladder). Other arms have
 *  no sub-bucket field at all — so a renderer narrowing on
 *  `column.key === "idle"` reads sub-rows without an optional dance,
 *  and the type system refuses to construct an idle column without
 *  the ladder or an awaiting/working/none column with one. */
export type WorkspaceSwitcherColumn =
  | (DescriptorFor<"idle"> & {
      entries: WorkspaceSwitcherEntry[];
      idleSubBuckets: WorkspaceSwitcherIdleSubBucket[];
    })
  | (DescriptorFor<Exclude<WorkspaceAgentBucket, "idle">> & {
      entries: WorkspaceSwitcherEntry[];
    });

/** Complete derived model for collapsed and expanded switcher renderers. */
export type WorkspaceSwitcherModel = {
  entries: WorkspaceSwitcherEntry[];
  compactGroups: WorkspaceSwitcherRepoGroup[];
  visibleEntries: WorkspaceSwitcherEntry[];
  selectedRepo: string | null;
  repoFacets: WorkspaceRepoFacet[];
  columns: WorkspaceSwitcherColumn[];
};

/** Classify live agent metadata into the agent-state buckets. Pure — does
 *  not consider staleness. Callers that have a staleness signal should
 *  prefer `entryBucket()` so parked terminals route to the Idle column;
 *  this function stays exported for the minimap badge, which colors tiles
 *  by agent state regardless of age. */
export function agentBucket(
  agent: AgentInfo | null | undefined,
): Exclude<WorkspaceAgentBucket, "idle"> {
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

/** Classify a terminal into a switcher column. Parked terminals (last
 *  agent transition older than the auto-park threshold, surfaced via the
 *  idle classifier as a non-null sub-bucket key) route to "idle"
 *  regardless of current agent state — the unified mental model is
 *  "anything parked goes to one place". A `null` classifier result keeps
 *  the entry on its agent-state column; the classifier itself is what
 *  enforces the `lastActivityAt === 0` plain-shell exclusion. */
export function entryBucket(
  info: TerminalDisplayInfo,
  idleClassifier?: (lastActivityAt: number) => IdleBucketKey | null,
): WorkspaceAgentBucket {
  if (idleClassifier?.(info.meta.lastActivityAt)) return "idle";
  return agentBucket(info.meta.agent);
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
 *  When `idleClassifier` is provided, parked-by-inactivity entries route
 *  to the Idle column with a populated `idleSub` and the column emits
 *  `idleSubBuckets` (4–12h, 12–24h, 24–48h, 48h+). The classifier is the
 *  sole clock-aware input — there is no separate `now` parameter and no
 *  separate stale predicate, so the model can't end up with two
 *  inconsistent views of the same tick. */
export function buildWorkspaceSwitcherModel(
  sources: WorkspaceSwitcherSourceEntry[],
  options: {
    query?: string;
    repoFilter?: string | null;
    activeId?: TerminalId | null;
    getRecency?: (id: TerminalId) => number;
    idleClassifier?: (lastActivityAt: number) => IdleBucketKey | null;
  } = {},
): WorkspaceSwitcherModel {
  const ordered = options.getRecency
    ? sortBySwitcherOrder(sources, options.getRecency)
    : sources;
  const idleClassifier = options.idleClassifier;
  const entries: WorkspaceSwitcherEntry[] = ordered.map((source) => {
    const baseFields = {
      id: source.id,
      repoName: source.info.key.group,
      label: source.info.key.label,
      suffix: source.info.key.suffix,
      info: source.info,
    };
    const searchText = searchTextFor(baseFields);
    const idleSub = idleClassifier?.(source.info.meta.lastActivityAt) ?? null;
    if (idleSub !== null) {
      return { ...baseFields, searchText, bucket: "idle" as const, idleSub };
    }
    return {
      ...baseFields,
      searchText,
      bucket: agentBucket(source.info.meta.agent),
    };
  });

  const { repoFacets, selectedRepo, visibleEntries } = searchResults(
    entries,
    options.query ?? "",
    options.repoFilter ?? null,
  );

  // Single pass: bucket every visible entry (and, for idle entries,
  // sub-bucket them) in one walk instead of N×M filters.
  const byBucket: Record<WorkspaceAgentBucket, WorkspaceSwitcherEntry[]> = {
    awaiting: [],
    working: [],
    idle: [],
    none: [],
  };
  const byIdleSub: Record<IdleBucketKey, WorkspaceSwitcherEntry[]> = {
    "4h-12h": [],
    "12h-24h": [],
    "24h-48h": [],
    "48h+": [],
  };
  for (const entry of visibleEntries) {
    byBucket[entry.bucket].push(entry);
    if (entry.bucket === "idle") byIdleSub[entry.idleSub].push(entry);
  }
  const columns: WorkspaceSwitcherColumn[] = WORKSPACE_AGENT_BUCKETS.map(
    (bucket) => {
      const bucketEntries = byBucket[bucket.key];
      if (bucket.key !== "idle") {
        return { ...bucket, entries: bucketEntries };
      }
      // The ladder is always rendered in full so empty rows read as a
      // positive "nothing parked here yet" signal rather than disappearing.
      const idleSubBuckets: WorkspaceSwitcherIdleSubBucket[] = IDLE_BUCKETS.map(
        (sub) => ({ ...sub, entries: byIdleSub[sub.key] }),
      );
      return { ...bucket, entries: bucketEntries, idleSubBuckets };
    },
  );

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
