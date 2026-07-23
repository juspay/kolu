/** Shared four-slot palette row — lead · identity · context · right rail.
 *
 *  Every result kind fills the same slots so a mixed root list stays scannable:
 *  workspace (StatePip + repo eyebrow + branch + intent + recency + `ws`),
 *  host (connection dot + user@host + status + `host`),
 *  command (glyph/icon + name + description + keybind + drill chevron + `cmd`).
 *
 *  Kind tags appear only during cross-kind root search (`showKindTag`); scoped
 *  drill-ins drop them as noise. */

import { StatePip } from "@kolu/solid-statepip";
import { TITLE_PIP_BOX } from "@kolu/solid-statepip/pipVariant";
import type { HostKey } from "kolu-common/hostKey";
import type { TerminalId } from "kolu-common/surface";
import type { TerminalMetadata } from "@kolu/padi/surface";
import { type Component, For, Show } from "solid-js";
import { Dynamic } from "solid-js/web";
import type { PaletteCommand, PaletteLabel } from "../CommandPalette";
import { rowSubline } from "../canvas/dock/rowSubline";
import {
  dotClass,
  hostLabel,
  sameHost,
  statusLabelShort,
} from "../host/hostChipTone";
import { firstIntentLine } from "../intent/text";
import { formatKeybind, type Keybind } from "../input/keyboard";
import { useStatePip } from "../terminal/statePipBind";
import { useTerminalStore } from "../terminal/useTerminalStore";
import { compactDelta } from "../time/duration";
import Kbd from "../ui/Kbd";
import { activeHost, padiMap } from "../wire";
import HighlightedText from "./highlightMatch";
import type { ResultKind } from "./rootIndex";

export type PaletteRowMeta = {
  kind: ResultKind;
  /** Multi-field AND-token corpus (workspace dock fields / host label+status). */
  searchText?: string;
  recencyAt?: number | null;
  terminalId?: TerminalId;
  repoName?: string;
  repoColor?: string;
  branchLabel?: string;
  hostKey?: HostKey;
};

/** Compact right-rail age — `2m` / `1h` / `3d`, empty when never active. */
function compactRecency(ts: number | null | undefined): string {
  if (ts === null || ts === undefined) return "";
  const { value, unit } = compactDelta(Date.now() - ts);
  if (unit === "s") return "now";
  return `${value}${unit}`;
}

function workspaceContext(meta: TerminalMetadata | undefined): string {
  if (!meta) return "";
  if (meta.intent) return firstIntentLine(meta.intent);
  return rowSubline(meta);
}

const KindTag: Component<{ kind: ResultKind }> = (props) => {
  const label =
    props.kind === "workspace" ? "ws" : props.kind === "host" ? "host" : "cmd";
  return (
    <span
      data-testid="palette-kind-tag"
      data-kind={props.kind}
      class="shrink-0 font-mono text-[0.6rem] tracking-[0.08em] uppercase text-fg-3 border border-edge/80 rounded-full px-1.5 py-px"
    >
      {label}
    </span>
  );
};

const WorkspaceLeadBound: Component<{
  id: TerminalId;
  meta: TerminalMetadata;
}> = (props) => {
  const store = useTerminalStore();
  // Unread folds into the StatePip amber corner badge — same binder as dock.
  const pip = useStatePip(
    () => props.id,
    () => props.meta,
    () => store.isUnread(props.id),
  );
  return <StatePip {...pip()} class={TITLE_PIP_BOX} />;
};

const WorkspaceLead: Component<{ id: TerminalId }> = (props) => {
  const store = useTerminalStore();
  const meta = () => store.getMetadata(props.id);
  return (
    <Show when={meta()}>
      {(m) => <WorkspaceLeadBound id={props.id} meta={m()} />}
    </Show>
  );
};

const HostLead: Component<{ host: HostKey }> = (props) => {
  const state = () => padiMap.entry(props.host).state();
  return (
    <span
      class={`inline-block h-2 w-2 rounded-full shrink-0 ${dotClass(state())}`}
      aria-hidden="true"
    />
  );
};

const CommandLead: Component<{
  icon?: Component<{ class?: string }>;
  selected: boolean;
}> = (props) => (
  <span
    class="shrink-0 w-4 h-4 inline-flex items-center justify-center rounded text-fg-3"
    classList={{
      "text-accent": props.selected,
    }}
  >
    <Show
      when={props.icon}
      fallback={
        <span class="font-mono text-[0.7rem] leading-none select-none">⌘</span>
      }
    >
      {(icon) => <Dynamic component={icon()} class="w-3 h-3" />}
    </Show>
  </span>
);

const PaletteRow: Component<{
  cmd: PaletteCommand | PaletteLabel;
  selected: boolean;
  query: string;
  /** Kind tags only during cross-kind root search. */
  showKindTag: boolean;
  drillable: boolean;
  onSelect: () => void;
  onHover: () => void;
}> = (props) => {
  const store = useTerminalStore();
  const row = () => props.cmd.row;
  const kind = (): ResultKind => row()?.kind ?? "command";

  const identityPrimary = (): string => {
    const r = row();
    if (r?.kind === "workspace") return r.branchLabel ?? props.cmd.name;
    if (r?.kind === "host" && r.hostKey) return hostLabel(r.hostKey);
    return props.cmd.name;
  };

  const contextLine = (): string => {
    const r = row();
    if (r?.kind === "workspace" && r.terminalId) {
      return workspaceContext(store.getMetadata(r.terminalId));
    }
    if (r?.kind === "host" && r.hostKey) {
      if (sameHost(r.hostKey, activeHost())) return "active";
      return statusLabelShort(padiMap.entry(r.hostKey).state());
    }
    return props.cmd.description ?? "";
  };

  const recencyLabel = (): string => {
    if (kind() !== "workspace") return "";
    return compactRecency(row()?.recencyAt);
  };

  return (
    <div
      role="option"
      tabIndex={-1}
      aria-selected={props.selected}
      data-selected={props.selected || undefined}
      data-palette-kind={kind()}
      // Exact command/row name for e2e — free of lead glyph / context text so
      // "Search workspaces" and "Nord" vs "One Nord" stay unambiguous.
      data-palette-name={props.cmd.name}
      class="flex items-center gap-2.5 px-2.5 py-1.5 text-[0.86rem] rounded-lg cursor-pointer transition-colors duration-100 min-w-0"
      classList={{
        "bg-accent/[0.14] text-fg shadow-[inset_0_0_0_1px_color-mix(in_oklch,var(--color-accent)_38%,transparent)]":
          props.selected,
        "text-fg-2 hover:bg-surface-2/50": !props.selected,
      }}
      onMouseEnter={() => props.onHover()}
      onClick={() => props.onSelect()}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          props.onSelect();
        }
      }}
    >
      {/* 1 · Lead — always occupied so identity columns align. */}
      <span class="shrink-0 w-4 inline-flex items-center justify-center">
        <Show when={kind() === "workspace" && row()?.terminalId}>
          {(id) => <WorkspaceLead id={id()} />}
        </Show>
        <Show when={kind() === "host" && row()?.hostKey}>
          {(host) => <HostLead host={host()} />}
        </Show>
        <Show when={kind() === "command"}>
          <CommandLead icon={props.cmd.icon} selected={props.selected} />
        </Show>
      </span>

      {/* 2 · Identity */}
      <div class="flex items-baseline gap-1.5 min-w-0 shrink">
        <Show when={kind() === "workspace" && row()?.repoName}>
          <span
            class="font-mono text-[0.72rem] font-semibold truncate max-w-[7rem]"
            style={{ color: row()?.repoColor }}
          >
            {row()?.repoName}
          </span>
        </Show>
        <span class="truncate min-w-0">
          <HighlightedText text={identityPrimary()} query={props.query} />
        </span>
      </div>

      {/* 3 · Context — one truncating line, never wraps. */}
      <Show when={contextLine()}>
        {(line) => (
          <span class="flex-1 min-w-0 text-fg-3 text-[0.76rem] truncate">
            <span class="text-fg-3/50 mr-1">·</span>
            {line()}
          </span>
        )}
      </Show>
      <Show when={!contextLine()}>
        <span class="flex-1 min-w-0" />
      </Show>

      {/* 4 · Right rail */}
      <span class="ml-auto shrink-0 flex items-center gap-1.5">
        <Show when={recencyLabel()}>
          {(label) => (
            <span class="font-mono text-[0.68rem] tabular-nums text-fg-3/80">
              {label()}
            </span>
          )}
        </Show>
        <Show when={props.cmd.keybind}>
          {(keybind) => {
            const kb = keybind() as Keybind | Keybind[];
            return (
              <span class="flex items-center gap-1">
                <For each={Array.isArray(kb) ? kb : [kb]}>
                  {(k) => <Kbd>{formatKeybind(k)}</Kbd>}
                </For>
              </span>
            );
          }}
        </Show>
        <Show when={props.showKindTag}>
          <KindTag kind={kind()} />
        </Show>
        <Show when={props.drillable}>
          <span
            aria-hidden="true"
            class="text-sm leading-none"
            classList={{
              "text-accent": props.selected,
              "text-fg-3/70": !props.selected,
            }}
          >
            ›
          </span>
        </Show>
      </span>
    </div>
  );
};

export default PaletteRow;
