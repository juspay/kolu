import type { AgentInfo, TerminalId } from "kolu-common/surface";
import { match } from "ts-pattern";
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
 *  recency value is plugged in via the accessor. */
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

export type AgentBucketKind = "awaiting" | "working" | "idle" | "none";

/** Stable agent-state buckets — co-locates each bucket's label and visual
 *  encoding (color, glyph) so consumers that paint by agent state read
 *  from one descriptor record. Consumed today by the canvas minimap;
 *  retained for downstream painters that want the same vocabulary. */
export const AGENT_BUCKETS = [
  {
    key: "idle",
    label: "Idle",
    textClass: "text-fg-3",
    accentVar: "var(--color-fg-3)",
    glyph: "☾",
  },
  {
    key: "awaiting",
    label: "Awaiting you",
    textClass: "text-alert",
    accentVar: "var(--color-alert)",
    glyph: "⏵",
  },
  {
    key: "working",
    label: "Working",
    textClass: "text-accent",
    accentVar: "var(--color-accent)",
    glyph: "▸",
  },
  {
    key: "none",
    label: "No agent",
    textClass: "text-fg-3",
    accentVar: "var(--color-fg-3)",
    glyph: "·",
  },
] as const satisfies readonly {
  key: AgentBucketKind;
  label: string;
  textClass: string;
  accentVar: string;
  glyph: string;
}[];

/** Searchable live-terminal entry — the output shape of
 *  `searchWorkspaceEntries`. Carries the precomputed `searchText` so
 *  re-filtering as the user types stays cheap, plus the repo / label /
 *  suffix that `dockRowChrome` helpers and the workspace-palette row
 *  read for presentation. */
export type DockEntry = {
  id: TerminalId;
  repoName: string;
  label: string;
  suffix?: string;
  info: TerminalDisplayInfo;
  searchText: string;
};

/** Classify live agent metadata into the agent-state buckets. Pure — does
 *  not consider staleness. Callers needing staleness-aware classification
 *  combine this with a `useStaleCheck`-derived predicate. */
export function agentBucket(
  agent: AgentInfo | null | undefined,
): Exclude<AgentBucketKind, "idle"> {
  // The `waiting | awaiting_user` pair is the same equivalence class
  // surfaced runtime-side by `isAttentionState` in `agentDisplay.ts` —
  // ts-pattern is used here instead so `.exhaustive()` flags any future
  // state literal that lands in `AgentInfo["state"]` without a bucket.
  return match(agent?.state)
    .with(undefined, () => "none" as const)
    .with("waiting", "awaiting_user", () => "awaiting" as const)
    .with("thinking", "tool_use", () => "working" as const)
    .exhaustive();
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

/** Concatenate every field a workspace search query might want to hit
 *  into a single lowercase string. Pre-computed once per entry so the
 *  re-filter loop stays O(N · tokens) on substring scans rather than
 *  re-reading the metadata tree. */
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

/** Sort live terminals by recency and hydrate each into a `DockEntry`
 *  with a precomputed `searchText`. Filtering is the caller's
 *  responsibility — the command palette's `filtered` memo runs the
 *  AND-token match against the row's `name` + `description` +
 *  `searchText`, so the workspace path stays consistent with every
 *  other palette row. */
export function searchWorkspaceEntries(
  sources: DockSourceEntry[],
  options: {
    getRecency?: (id: TerminalId) => number;
  } = {},
): DockEntry[] {
  const ordered = options.getRecency
    ? sortDockEntriesByRecency(sources, options.getRecency)
    : sources;
  return ordered.map((source) => {
    const baseFields = {
      id: source.id,
      repoName: source.info.key.group,
      label: source.info.key.label,
      suffix: source.info.key.suffix,
      info: source.info,
    };
    return { ...baseFields, searchText: searchTextFor(baseFields) };
  });
}
