/** Live "this is the card you'll get" preview for the New terminal flow.
 *
 *  Shown while the palette is drilled into New terminal (repo pick or
 *  worktree-name + agent). Same identity atoms as dock / tile: monogram,
 *  fleet hue, annotation colour, agent mark — so create is "name the
 *  thing, then place it," not "spawn, then recognize it." */

import type { TerminalMetadata } from "@kolu/padi/surface";
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
import { iconForCommand } from "../ui/agentDisplay";
import { TerminalIcon } from "../ui/Icons";
import RepoMonogram from "../ui/RepoMonogram";
import { NEW_TERMINAL_GROUP } from "./newTerminalGroup";

export type CreatePreviewModel = {
  repoName: string;
  repoColor: string;
  annotation: string;
  /** Fleet identity hue when the annotation is a real branch/label; `null`
   *  for provisional chrome copy ("worktree name…", "choose a destination"). */
  annotationColor: string | null;
  agentLabel: string;
  AgentIcon: Component<{ class?: string }>;
};

/** True when the palette path is inside the New terminal create flow.
 *  Root segment only (name + kind) — a host/repo named "New terminal" deeper
 *  in the path must not mount this preview. */
export function isNewTerminalPath(
  path: readonly { name: string; kind: string }[],
): boolean {
  const root = path[0];
  return root?.name === NEW_TERMINAL_GROUP && root.kind === "group";
}

/** Dim monogram when no real repo identity is known yet. */
const NEUTRAL_REPO_COLOR = "oklch(0.55 0.01 250)";

/** One model shape — branches only choose the semantic inputs. */
function buildModel(
  repoName: string,
  annotation: string,
  agentLabel: string,
  AgentIcon: Component<{ class?: string }>,
  opts?: {
    /** Annotation is provisional UI copy, not a branch/label identity. */
    provisionalAnnotation?: boolean;
    /** Repo name is provisional chrome ("new"), not a real group. */
    provisionalRepo?: boolean;
  },
): CreatePreviewModel {
  const provisionalAnno = opts?.provisionalAnnotation === true;
  const provisionalRepo = opts?.provisionalRepo === true;
  const colorKeys: string[] = [];
  if (!provisionalRepo) colorKeys.push(repoName);
  if (!provisionalAnno) colorKeys.push(annotation);
  // Fail loud like fleet/inspector — assignColors covers every key it was
  // given; a miss is a programmer bug, not a soft neutral.
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

/** Derive the preview from palette navigation state. Pure function of the
 *  explicit args — callers pass `defaultRepo` (e.g. recentRepos[0]); this fold
 *  never reads ambient feeds itself. */
export function createPreviewModel(
  path: readonly { name: string; kind: string }[],
  mode: PaletteMode,
  query: string,
  highlighted: PaletteCommand | PaletteLabel | undefined,
  activeMeta: TerminalMetadata | null | undefined,
  defaultRepo: { repoName: string } | null,
): CreatePreviewModel | null {
  if (!isNewTerminalPath(path)) return null;

  // Worktree leaf: New terminal › $repo (value input).
  if (mode.kind === "value" && path.at(-1)?.kind === "value") {
    const leaf = mode.leaf;
    const repoName = leaf.name;
    const typed = query.trim();
    const agentLabel =
      highlighted?.kind === "label" ? highlighted.name : "Plain shell";
    const agentCmd =
      highlighted?.kind === "label" && typeof highlighted.data === "string"
        ? highlighted.data
        : undefined;
    const AgentIcon =
      (agentCmd ? iconForCommand(agentCmd) : undefined) ?? TerminalIcon;
    return buildModel(
      repoName,
      typed || "worktree name…",
      agentLabel,
      AgentIcon,
      { provisionalAnnotation: typed.length === 0 },
    );
  }

  // New terminal root: highlight drives preview.
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

  // Filtering with zero matches → no executable selection: never claim a
  // recent repo the Enter path cannot create. Quiet root may hint at the
  // optional recent-repo default; otherwise provisional chrome.
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
        // Every read stays a CALL: the memo hands back a fresh model on each
        // keystroke / highlight move while the Show condition never goes falsy,
        // so unwrapping the accessor here would freeze the card on the first
        // model. Non-keyed Show keeps the subtree alive across those recomputes.
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
