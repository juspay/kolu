/** Dock / switcher shared presentation leaves — paint buckets and the
 *  multi-field search corpus. The old WorkspaceGrid mega-model
 *  (`buildDockModel`, `DockSourceEntry`, repo facets, columns) was retired
 *  with the grid; only the live leaves remain. */

import { activeArm, type TerminalMetadata } from "@kolu/padi-client/surface";
import {
  type AgentInfo,
  type AgentPaintClass,
  agentPaintClass,
  type PrResult,
} from "kolu-common/surface";

/** The switcher-column bucket vocabulary — the shared `AgentPaintClass`
 *  (awaiting | linger | working | none) plus the dock's own `idle` triage column.
 *  Declared as an EXTENSION of `AgentPaintClass` (not a re-spelled literal set)
 *  so `Exclude<AgentBucketKind, "idle">` resolves to exactly `AgentPaintClass`. */
export type AgentBucketKind = AgentPaintClass | "idle";

/** Stable agent-state bucket descriptors (paint classes + idle). Used by
 *  minimap / aura presentation, not a column grid. */
export const AGENT_BUCKETS = [
  {
    key: "idle",
    label: "Idle",
    empty: "No parked terminals",
    textClass: "text-fg-3",
    accentVar: "var(--color-fg-3)",
    borderClass: "",
  },
  {
    key: "awaiting",
    label: "Awaiting you",
    empty: "No terminals need input",
    textClass: "text-alert",
    accentVar: "var(--color-alert)",
    borderClass: "pill-border pill-border-awaiting",
  },
  {
    // Post-turn lull — same violet family as awaiting, dimmed: the minimap /
    // aura presentation for a just-finished agent. Split from `awaiting` so
    // needs-you renders full-strength (the fucknotif fix).
    key: "linger",
    label: "Turn finished",
    empty: "No terminals just finished",
    textClass: "text-alert/55",
    accentVar: "color-mix(in oklab, var(--color-alert) 55%, transparent)",
    borderClass: "pill-border pill-border-awaiting",
  },
  {
    key: "working",
    label: "Working",
    empty: "No agents are running",
    textClass: "text-busy",
    accentVar: "var(--color-busy)",
    borderClass: "pill-border pill-border-working",
  },
  {
    key: "none",
    label: "No agent",
    empty: "No plain shells match",
    textClass: "text-fg-3",
    accentVar: "var(--color-fg-3)",
    borderClass: "",
  },
] as const satisfies readonly {
  key: AgentBucketKind;
  label: string;
  empty: string;
  textClass: string;
  accentVar: string;
  borderClass: string;
}[];

/** Classify live agent metadata into paint buckets. Defers the per-state
 *  paint decision to `agentPaintClass` in `@kolu/terminal-vocab`. */
export function paintBucket(
  agent: AgentInfo | null | undefined,
): Exclude<AgentBucketKind, "idle"> {
  if (!agent) return "none";
  return agentPaintClass(agent.state);
}

/** Bucket a terminal by its live agent — `paintBucket` over the active arm. */
export function metaBucket(
  meta: TerminalMetadata,
): Exclude<AgentBucketKind, "idle"> {
  return paintBucket(activeArm(meta)?.agent);
}

const BUCKET_BY_KEY: Record<AgentBucketKind, (typeof AGENT_BUCKETS)[number]> =
  AGENT_BUCKETS.reduce(
    (acc, bucket) => {
      acc[bucket.key] = bucket;
      return acc;
    },
    {} as Record<AgentBucketKind, (typeof AGENT_BUCKETS)[number]>,
  );

/** Look up a bucket descriptor by its key. */
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
  if (!pr) return [];
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
    case "unsupported":
      return [pr.kind];
    default: {
      const _exhaustive: never = pr;
      return _exhaustive;
    }
  }
}

/** Multi-field search corpus for a live terminal — repo, branch, intent-related
 *  metadata, agent, foreground, cwd, PR. Shared by the dock filter and the
 *  command-palette terminal index so both surfaces match the same tokens. */
export function workspaceSearchText(entry: {
  repoName: string;
  label: string;
  suffix?: string;
  meta: TerminalMetadata;
}): string {
  const { meta } = entry;
  const git = meta.git;
  const arm = activeArm(meta);
  const fg = arm?.foreground;
  const agent = arm?.agent;
  const values: string[] = [
    entry.repoName,
    entry.label,
    ...prSearchFields(arm?.pr),
  ];

  add(values, entry.suffix);
  add(values, meta.cwd);
  add(values, meta.lastAgentCommand);
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
  add(values, meta.intent);

  return values.join(" ").toLowerCase();
}
