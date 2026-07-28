/** Live "this is the card you'll get" preview for the New terminal flow.
 *
 *  Shown while the palette is drilled into New terminal (repo pick or
 *  worktree-name + agent). Same identity atoms as dock / tile: monogram,
 *  fleet hue, annotation colour, agent mark — so create is "name the
 *  thing, then place it," not "spawn, then recognize it." */

import type { TerminalMetadata } from "@kolu/padi/surface";
import { terminalKey } from "kolu-common/terminalKey";
import type { Component } from "solid-js";
import { createMemo, Show } from "solid-js";
import { Dynamic } from "solid-js/web";
import type {
  PaletteCommand,
  PaletteLabel,
  PaletteMode,
} from "../CommandPalette";
import { recentRepos } from "../hostScope/activeWire";
import { assignColors } from "../terminal/terminalDisplay";
import { useTerminalStore } from "../terminal/useTerminalStore";
import { iconForCommand } from "../ui/agentDisplay";
import { TerminalIcon } from "../ui/Icons";
import RepoMonogram from "../ui/RepoMonogram";

/** Group name for the create flow — keep in sync with `commands.tsx`. */
export const NEW_TERMINAL_GROUP = "New terminal";

export type CreatePreviewModel = {
  repoName: string;
  repoColor: string;
  annotation: string;
  annotationColor: string;
  agentLabel: string;
  AgentIcon: Component<{ class?: string }>;
};

/** True when the palette path is inside the New terminal create flow. */
export function isNewTerminalPath(
  path: readonly { name: string; kind: string }[],
): boolean {
  return path.some((p) => p.name === NEW_TERMINAL_GROUP);
}

/** Derive the preview from palette navigation state. Pure-ish: reads
 *  live store + recentRepos for cwd / repo facts. */
export function createPreviewModel(
  path: readonly { name: string; kind: string }[],
  mode: PaletteMode,
  query: string,
  highlighted: PaletteCommand | PaletteLabel | undefined,
  activeMeta: TerminalMetadata | null | undefined,
): CreatePreviewModel | null {
  if (!isNewTerminalPath(path)) return null;

  // Worktree leaf: New terminal › $repo (value input).
  if (mode.kind === "value" && path.at(-1)?.kind === "value") {
    const leaf = mode.leaf;
    const repoName = leaf.name;
    const annotation = query.trim() || "worktree name…";
    const colors = assignColors([repoName, annotation]);
    const agentLabel =
      highlighted?.kind === "label" ? highlighted.name : "Plain shell";
    const agentCmd =
      highlighted?.kind === "label" && typeof highlighted.data === "string"
        ? highlighted.data
        : undefined;
    const AgentIcon =
      (agentCmd ? iconForCommand(agentCmd) : undefined) ?? TerminalIcon;
    return {
      repoName,
      repoColor: colors.get(repoName)!,
      annotation,
      annotationColor: colors.get(annotation)!,
      agentLabel,
      AgentIcon,
    };
  }

  // New terminal root: highlight drives preview.
  if (
    highlighted?.kind === "action" &&
    highlighted.name === "In current directory"
  ) {
    const key = activeMeta
      ? terminalKey({ git: activeMeta.git, cwd: activeMeta.cwd })
      : { group: "shell", label: "current directory" };
    const colors = assignColors([key.group, key.label]);
    return {
      repoName: key.group,
      repoColor: colors.get(key.group)!,
      annotation: key.label,
      annotationColor: colors.get(key.label)!,
      agentLabel: "Plain shell",
      AgentIcon: TerminalIcon,
    };
  }

  if (highlighted?.kind === "value") {
    const repoName = highlighted.name;
    const annotation = "worktree name…";
    const colors = assignColors([repoName, annotation]);
    return {
      repoName,
      repoColor: colors.get(repoName)!,
      annotation,
      annotationColor: colors.get(annotation)!,
      agentLabel: "Pick agent after name",
      AgentIcon: TerminalIcon,
    };
  }

  // Default while in New terminal with no useful highlight.
  const repos = recentRepos();
  if (repos[0]) {
    const repoName = repos[0].repoName;
    const annotation = "choose a destination";
    const colors = assignColors([repoName, annotation]);
    return {
      repoName,
      repoColor: colors.get(repoName)!,
      annotation,
      annotationColor: colors.get(annotation)!,
      agentLabel: "—",
      AgentIcon: TerminalIcon,
    };
  }

  const annotation = "choose a destination";
  const repoName = "new";
  const colors = assignColors([repoName, annotation]);
  return {
    repoName,
    repoColor: colors.get(repoName)!,
    annotation,
    annotationColor: colors.get(annotation)!,
    agentLabel: "—",
    AgentIcon: TerminalIcon,
  };
}

const CreateIdentityPreview: Component<{
  path: readonly { name: string; kind: string }[];
  mode: PaletteMode;
  query: string;
  highlighted: PaletteCommand | PaletteLabel | undefined;
}> = (props) => {
  const store = useTerminalStore();
  const model = createMemo(() =>
    createPreviewModel(
      props.path,
      props.mode,
      props.query,
      props.highlighted,
      store.activeMeta(),
    ),
  );

  return (
    <Show when={model()}>
      {(m) => (
        <div
          data-testid="create-identity-preview"
          class="px-5 py-2.5 border-t border-edge/60 bg-surface-0/50"
        >
          <div class="text-[0.64rem] font-semibold tracking-[0.12em] uppercase text-fg-3/80 mb-1.5">
            Will create
          </div>
          <div
            class="flex items-center gap-2.5 min-w-0 rounded-lg px-2.5 py-2 repo-spine border border-edge/50 bg-surface-1/80"
            style={{ "--repo-color": m().repoColor }}
          >
            <span
              class="shrink-0 w-5 h-5 inline-flex items-center justify-center rounded-md bg-surface-2 text-fg-2"
              title={m().agentLabel}
              data-testid="create-preview-agent"
            >
              <Dynamic component={m().AgentIcon} class="w-3.5 h-3.5" />
            </span>
            <RepoMonogram
              group={m().repoName}
              color={m().repoColor}
              size="sm"
              data-testid="create-preview-monogram"
            />
            <div class="min-w-0 flex-1">
              <div
                class="repo-name-ink font-mono text-[0.8rem] font-semibold truncate leading-tight"
                data-testid="create-preview-repo"
              >
                {m().repoName}
              </div>
              <div
                class="annotation-ink font-mono text-[0.68rem] truncate leading-snug mt-0.5"
                style={{ "--annotation-color": m().annotationColor }}
                data-testid="create-preview-annotation"
              >
                {m().annotation}
              </div>
            </div>
            <span
              class="shrink-0 text-[0.65rem] text-fg-3 truncate max-w-[7rem]"
              data-testid="create-preview-agent-label"
            >
              {m().agentLabel}
            </span>
          </div>
        </div>
      )}
    </Show>
  );
};

export default CreateIdentityPreview;
