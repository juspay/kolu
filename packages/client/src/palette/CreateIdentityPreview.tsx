import type { TerminalMetadata } from "@kolu/padi-client/surface";
import { terminalKey } from "@kolu/terminal-vocab/terminalKey";
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
import { TerminalIcon } from "../ui/Icons";
import RepoMonogram from "../ui/RepoMonogram";
import { NEW_TERMINAL_GROUP } from "./newTerminalGroup";

export type CreatePreviewModel = {
  repoName: string;
  repoColor: string;
  annotation: string;
  annotationColor: string | null;
  agentLabel: string;
  AgentIcon: Component<{ class?: string }>;
};

export function isNewTerminalPath(
  path: readonly { name: string; kind: string }[],
): boolean {
  const root = path[0];
  return root?.name === NEW_TERMINAL_GROUP && root.kind === "group";
}

const NEUTRAL_REPO_COLOR = "oklch(0.55 0.01 250)";

function buildModel(
  repoName: string,
  annotation: string,
  agentLabel: string,
  AgentIcon: Component<{ class?: string }>,
  opts?: {
    provisionalAnnotation?: boolean;
    provisionalRepo?: boolean;
  },
): CreatePreviewModel {
  const provisionalAnno = opts?.provisionalAnnotation === true;
  const provisionalRepo = opts?.provisionalRepo === true;
  const colorKeys: string[] = [];
  if (!provisionalRepo) colorKeys.push(repoName);
  if (!provisionalAnno) colorKeys.push(annotation);
  const colors = colorKeys.length > 0 ? assignColors(colorKeys) : null;
  let repoColor = NEUTRAL_REPO_COLOR;
  if (!provisionalRepo) {
    const c = colors?.get(repoName);
    if (c === undefined) {
      throw new Error(
        `assignColors missing create-preview repo "${repoName}" — map must cover every key`,
      );
    }
    repoColor = c;
  }
  let annotationColor: string | null = null;
  if (!provisionalAnno) {
    const c = colors?.get(annotation);
    if (c === undefined) {
      throw new Error(
        `assignColors missing create-preview annotation "${annotation}" — map must cover every key`,
      );
    }
    annotationColor = c;
  }
  return {
    repoName,
    repoColor,
    annotation,
    annotationColor,
    agentLabel,
    AgentIcon,
  };
}

export function createPreviewModel(
  path: readonly { name: string; kind: string }[],
  mode: PaletteMode,
  query: string,
  highlighted: PaletteCommand | PaletteLabel | undefined,
  activeMeta: TerminalMetadata | null | undefined,
  defaultRepo: { repoName: string } | null,
): CreatePreviewModel | null {
  if (!isNewTerminalPath(path)) return null;

  if (mode.kind === "value" && path.at(-1)?.kind === "value") {
    const leaf = mode.leaf;
    const repoName = leaf.name;
    const typed = query.trim();
    const agentLabel =
      highlighted?.kind === "label" ? highlighted.name : "Plain shell";
    const AgentIcon =
      (highlighted?.kind === "label" ? highlighted.icon : undefined) ??
      TerminalIcon;
    return buildModel(
      repoName,
      typed || "worktree name…",
      agentLabel,
      AgentIcon,
      { provisionalAnnotation: typed.length === 0 },
    );
  }

  if (
    highlighted?.kind === "action" &&
    highlighted.name === "In current directory"
  ) {
    const key = activeMeta
      ? terminalKey({ git: activeMeta.git, cwd: activeMeta.cwd })
      : { group: "shell", label: "current directory" };
    return buildModel(key.group, key.label, "Plain shell", TerminalIcon);
  }

  if (highlighted?.kind === "value") {
    return buildModel(
      highlighted.name,
      "worktree name…",
      "Pick agent after name",
      TerminalIcon,
      { provisionalAnnotation: true },
    );
  }

  const noExecutable =
    mode.kind === "filter" && query.trim().length > 0 && !highlighted;
  const hintRepo = !noExecutable ? defaultRepo : null;
  if (hintRepo) {
    return buildModel(
      hintRepo.repoName,
      "choose a destination",
      "—",
      TerminalIcon,
      { provisionalAnnotation: true },
    );
  }

  return buildModel("new", "choose a destination", "—", TerminalIcon, {
    provisionalAnnotation: true,
    provisionalRepo: true,
  });
}

const CreateIdentityPreview: Component<{
  path: readonly { name: string; kind: string }[];
  mode: PaletteMode;
  query: string;
  highlighted: PaletteCommand | PaletteLabel | undefined;
}> = (props) => {
  const store = useTerminalStore();
  const model = createMemo(() => {
    const repos = recentRepos();
    return createPreviewModel(
      props.path,
      props.mode,
      props.query,
      props.highlighted,
      store.activeMeta(),
      repos[0] ? { repoName: repos[0].repoName } : null,
    );
  });

  return (
    <Show when={model()}>
      {(preview) => {
        const annotationColor = () => preview().annotationColor;
        const annotationStyle = () => {
          const color = annotationColor();
          return color != null ? { "--annotation-color": color } : undefined;
        };
        return (
          <div
            data-testid="create-identity-preview"
            class="px-5 py-2.5 border-t border-edge/60 bg-surface-0/50"
          >
            <div class="text-[0.64rem] font-semibold tracking-[0.12em] uppercase text-fg-3/80 mb-1.5">
              Will create
            </div>
            <div
              class="flex items-center gap-2.5 min-w-0 rounded-lg px-2.5 py-2 repo-spine border border-edge/50 bg-surface-1/80"
              style={{ "--repo-color": preview().repoColor }}
            >
              <span
                class="shrink-0 w-5 h-5 inline-flex items-center justify-center rounded-md bg-surface-2 text-fg-2"
                title={preview().agentLabel}
                data-testid="create-preview-agent"
              >
                <Dynamic component={preview().AgentIcon} class="w-3.5 h-3.5" />
              </span>
              <RepoMonogram
                group={preview().repoName}
                color={preview().repoColor}
                size="sm"
                data-testid="create-preview-monogram"
              />
              <div class="min-w-0 flex-1">
                <div
                  class="repo-name-ink font-mono text-[0.8rem] font-semibold truncate leading-tight"
                  data-testid="create-preview-repo"
                >
                  {preview().repoName}
                </div>
                <div
                  class="font-mono text-[0.68rem] truncate leading-snug mt-0.5"
                  classList={{
                    "annotation-ink": annotationColor() != null,
                    "text-fg-3": annotationColor() == null,
                  }}
                  style={annotationStyle()}
                  data-testid="create-preview-annotation"
                >
                  {preview().annotation}
                </div>
              </div>
              <span
                class="shrink-0 text-[0.65rem] text-fg-3 truncate max-w-[7rem]"
                data-testid="create-preview-agent-label"
              >
                {preview().agentLabel}
              </span>
            </div>
          </div>
        );
      }}
    </Show>
  );
};

export default CreateIdentityPreview;
