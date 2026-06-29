import {
  activeArm,
  type AgentInfo,
  agentPaintClass,
  type AgentPaintClass,
  type PrResult,
  type TerminalId,
  type TerminalMetadata,
} from "kolu-common/surface";
import { matchesAllTokens, tokenize } from "../search";
import {
  IDLE_BUCKETS,
  type IdleBucket,
  type IdleBucketKey,
} from "../terminal/activityWindow";
import type { TerminalDisplayInfo } from "../terminal/terminalDisplay";
import type { TileLayout } from "./TileLayout";

/** Live-terminal source row before a presentation-specific order is applied. */
export interface DockSourceEntry {
  id: TerminalId;
  info: TerminalDisplayInfo;
  layout?: TileLayout;
}

/** Pair terminal ids with display info and optional canvas layout. */
export function buildWorkspaceEntries(
  ids: TerminalId[],
  getDisplayInfo: (id: TerminalId) => TerminalDisplayInfo | undefined,
  getLayout?: (id: TerminalId) => TileLayout | undefined,
): DockSourceEntry[] {
  const entries: DockSourceEntry[] = [];
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
export function sortDockEntriesByRecency(
  entries: DockSourceEntry[],
  getRecency: (id: TerminalId) => number,
): DockSourceEntry[] {
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

/** The switcher-column bucket vocabulary — the shared `AgentPaintClass`
 *  (awaiting | working | none) plus the dock's own `idle` triage column.
 *  Declared as an EXTENSION of `AgentPaintClass` (not a re-spelled literal set)
 *  so `Exclude<AgentBucketKind, "idle">` resolves to exactly `AgentPaintClass` —
 *  the paint fold's return type — making the value `paintBucket` feeds into
 *  `StatePip` (typed `DockRowBucket`) a DECLARED widening rather than a literal
 *  coincidence. */
export type AgentBucketKind = AgentPaintClass | "idle";

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
export const AGENT_BUCKETS = [
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
  key: AgentBucketKind;
  label: string;
  empty: string;
  textClass: string;
  accentVar: string;
  borderClass: string;
  glyph: string;
}[];

type DockEntryBase = {
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
export type DockEntry =
  | (DockEntryBase & {
      bucket: "idle";
      idleSub: IdleBucketKey;
    })
  | (DockEntryBase & {
      bucket: Exclude<AgentBucketKind, "idle">;
    });

/** Repo facet derived from the current search result set. */
export type RepoFacet = {
  repoName: string;
  count: number;
  color: string;
};

/** Idle column sub-row. Empty buckets stay in the array so the column
 *  always shows the full ladder (4–12h, 12–24h, 24–48h, 48h+) — empty
 *  ranges read as a positive signal ("nothing parked here yet"). */
export type IdleSubBucket = IdleBucket & {
  entries: DockEntry[];
};

/** Bucket descriptor narrowed to a specific column key — preserves the
 *  per-key invariant in the descriptor table (label, glyph, etc.) so the
 *  discriminated `DockColumn` arms below stay tight to
 *  their own descriptor row. */
type DescriptorFor<K extends AgentBucketKind> = Extract<
  (typeof AGENT_BUCKETS)[number],
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
export type DockColumn =
  | (DescriptorFor<"idle"> & {
      entries: DockEntry[];
      idleSubBuckets: IdleSubBucket[];
    })
  | (DescriptorFor<Exclude<AgentBucketKind, "idle">> & {
      entries: DockEntry[];
    });

/** Complete derived model for the dock's mega-level renderer. */
export type DockModel = {
  entries: DockEntry[];
  visibleEntries: DockEntry[];
  selectedRepo: string | null;
  repoFacets: RepoFacet[];
  columns: DockColumn[];
};

/** Classify live agent metadata into the dock's agent-state PAINT buckets — the
 *  canvas tile aura, the minimap badge, the expanded-switcher columns. Pure —
 *  does not consider staleness. Callers that have a staleness signal should
 *  prefer `entryBucket()` so parked terminals route to the Idle column.
 *
 *  Defers the per-state PAINT decision to `agentPaintClass` in
 *  `@kolu/pulam-library/agentProjection`, so the closed agent-state set is
 *  folded to a paint class in ONE schema-fenced file: a new state literal
 *  compile-fails THERE (`state satisfies never`) until its paint class is
 *  decided, rather than silently routing through a hand-copied dock-local
 *  switch. This function adds only the `null` agent → `none` arm (an absent
 *  agent has no glow); the live-agent fold is `agentPaintClass`.
 *
 *  This is the PAINT fold, NOT the needs-you RANKING (that's `dockRowRanking`'s
 *  `agentUrgency`). The paint vocabulary — {awaiting, working, none} — has no
 *  quiet-agent slot, so the post-turn lull (`waiting`) folds to `awaiting`: a
 *  just-finished agent keeps its tile glow until it parks. The ranking reads
 *  `agentUrgency`, where `waiting` is idle. The two legitimately differ on
 *  `waiting` and stay separate functions, co-located behind the schema fence.
 *
 *  Named `paintBucket` — NOT `agentBucket` — so the name carries the concept:
 *  `agentBucket` unambiguously means the shared projection's activity fold
 *  (`@kolu/pulam-library/agentProjection`), and `paintBucket` is this
 *  agent-optional paint adapter (the per-state fold itself is `agentPaintClass`
 *  in the projection; this only lifts it over an absent agent). */
export function paintBucket(
  agent: AgentInfo | null | undefined,
): Exclude<AgentBucketKind, "idle"> {
  if (!agent) return "none";
  return agentPaintClass(agent.state);
}

/** Bucket a terminal by its live agent — `paintBucket` over the active arm. A
 *  sleeping/absent terminal has no live agent, so it folds to the idle/"none"
 *  bucket. The single fold so presence surfaces (dock rows, minimap badge,
 *  canvas aura) don't re-spell the active-narrow + bucket at every call site. */
export function metaBucket(
  meta: TerminalMetadata,
): Exclude<AgentBucketKind, "idle"> {
  return paintBucket(activeArm(meta)?.agent);
}

/** Classify a terminal into a switcher column. Parked terminals (last
 *  agent transition older than the activity-window threshold, surfaced via
 *  the idle classifier as a non-null sub-bucket key) route to "idle"
 *  regardless of current agent state — the unified mental model is
 *  "anything past the threshold goes to one place." Identity for stale-
 *  but-still-awaiting agents is preserved at the *render* layer
 *  (`QuietRowBody` paints `AgentIndicator` when `meta.agent` is set).
 *  A `null` classifier result keeps the entry on its agent-state column;
 *  the classifier itself is what enforces the `lastActivityAt === 0`
 *  plain-shell exclusion. */
export function entryBucket(
  info: TerminalDisplayInfo,
  idleClassifier?: (lastActivityAt: number) => IdleBucketKey | null,
): AgentBucketKind {
  if (idleClassifier?.(info.meta.lastActivityAt)) return "idle";
  return metaBucket(info.meta);
}

const BUCKET_BY_KEY: Record<AgentBucketKind, (typeof AGENT_BUCKETS)[number]> =
  AGENT_BUCKETS.reduce(
    (acc, bucket) => {
      acc[bucket.key] = bucket;
      return acc;
    },
    {} as Record<AgentBucketKind, (typeof AGENT_BUCKETS)[number]>,
  );

/** Look up a bucket descriptor by its key. Used by presentation code
 *  that has an entry's bucket and needs the matching label/color. */
export function bucketDescriptor(
  bucket: AgentBucketKind,
): (typeof AGENT_BUCKETS)[number] {
  return BUCKET_BY_KEY[bucket];
}

function add(values: string[], value: unknown): void {
  if (value === null || value === undefined) return;
  values.push(String(value));
}

function prSearchFields(pr: PrResult | undefined): string[] {
  if (!pr) return []; // sleeping/absent: no live PR
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
  // sleeping/absent terminal has no live overlay (arm undefined → fields undefined)
  const arm = activeArm(info.meta);
  const fg = arm?.foreground;
  const agent = arm?.agent;
  const values: string[] = [
    entry.repoName,
    entry.label,
    ...prSearchFields(arm?.pr),
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

function matchesQuery(entry: DockEntry, tokens: string[]): boolean {
  return matchesAllTokens(entry.searchText, tokens);
}

/** Derive the dock mega-level projections (search, facets, bucket
 *  columns) from one live-terminal entry list. Owns the ordering
 *  pipeline — when `getRecency` is provided, applies
 *  `sortDockEntriesByRecency` internally so callers can't feed unsorted
 *  entries into the grouping. When `idleClassifier` is provided,
 *  parked-by-inactivity entries route to the Idle column with a
 *  populated `idleSub` and the column emits `idleSubBuckets` (4–12h,
 *  12–24h, 24–48h, 48h+). The classifier is the sole clock-aware
 *  input — there is no separate `now` parameter and no separate stale
 *  predicate, so the model can't end up with two inconsistent views
 *  of the same tick. */
export function buildDockModel(
  sources: DockSourceEntry[],
  options: {
    query?: string;
    repoFilter?: string | null;
    getRecency?: (id: TerminalId) => number;
    idleClassifier?: (lastActivityAt: number) => IdleBucketKey | null;
  } = {},
): DockModel {
  const ordered = options.getRecency
    ? sortDockEntriesByRecency(sources, options.getRecency)
    : sources;
  const idleClassifier = options.idleClassifier;
  const entries: DockEntry[] = ordered.map((source) => {
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
      bucket: metaBucket(source.info.meta),
    };
  });

  const { repoFacets, selectedRepo, visibleEntries } = searchResults(
    entries,
    options.query ?? "",
    options.repoFilter ?? null,
  );

  // Single pass: bucket every visible entry (and, for idle entries,
  // sub-bucket them) in one walk instead of N×M filters.
  const byBucket: Record<AgentBucketKind, DockEntry[]> = {
    awaiting: [],
    working: [],
    idle: [],
    none: [],
  };
  const byIdleSub: Record<IdleBucketKey, DockEntry[]> = {
    "4h-12h": [],
    "12h-24h": [],
    "24h-48h": [],
    "48h+": [],
  };
  for (const entry of visibleEntries) {
    byBucket[entry.bucket].push(entry);
    if (entry.bucket === "idle") byIdleSub[entry.idleSub].push(entry);
  }
  const columns: DockColumn[] = AGENT_BUCKETS.map((bucket) => {
    const bucketEntries = byBucket[bucket.key];
    if (bucket.key !== "idle") {
      return { ...bucket, entries: bucketEntries };
    }
    // The ladder is always rendered in full so empty rows read as a
    // positive "nothing parked here yet" signal rather than disappearing.
    const idleSubBuckets: IdleSubBucket[] = IDLE_BUCKETS.map((sub) => ({
      ...sub,
      entries: byIdleSub[sub.key],
    }));
    return { ...bucket, entries: bucketEntries, idleSubBuckets };
  });

  return {
    entries,
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
  entries: DockEntry[],
  query: string,
  repoFilter: string | null,
): {
  repoFacets: RepoFacet[];
  selectedRepo: string | null;
  visibleEntries: DockEntry[];
} {
  const tokens = tokenize(query);
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
