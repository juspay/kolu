import { compactDelta } from "@kolu/terminal-vocab/duration";
import type { TerminalMetadata } from "@kolu/padi-client/surface";
import { StatePip } from "@kolu/solid-statepip";
import { TITLE_PIP_BOX } from "@kolu/solid-statepip/pipVariant";
import {
  encodeHostKey,
  type HostKey,
  hostKeysEqual as sameHost,
} from "kolu-common/hostKey";
import { DASH, type TerminalId } from "kolu-common/surface";
import { type Component, For, Show } from "solid-js";
import { Dynamic } from "solid-js/web";
import type { PaletteCommand, PaletteLabel } from "../CommandPalette";
import { rowSubline } from "@kolu/solid-dockrow/rowValues";
import { HostIdentityLabel } from "../host/HostIdentityLabel";
import {
  dotClass,
  hostHue,
  hostLabel,
  hostRowContext,
  statusTitle,
} from "../host/hostChipTone";
import { useHostKavalChain } from "../host/useHostKaval";
import { formatKeybind, type Keybind } from "../input/keyboard";
import { IntentMarkdownInline } from "../intent/IntentMarkdown";
import { annotationLine } from "../intent/text";
import { useStatePip } from "../terminal/statePipBind";
import { useTerminalStore } from "../terminal/useTerminalStore";
import Kbd from "../ui/Kbd";
import RepoMonogram from "../ui/RepoMonogram";
import { activeHost, padiMap } from "../wire";
import HighlightedText from "./highlightMatch";
import type { ResultKind } from "./rootIndex";

function encodeHostAttr(h: HostKey): string {
  return encodeHostKey(h);
}

export type PaletteRowMeta = {
  kind: ResultKind;
  searchText?: string;
  recencyAt?: number | null;
  visitedAt?: number;
  terminalId?: TerminalId;
  terminalMeta?: TerminalMetadata;
  context?: string;
  repoName?: string;
  repoColor?: string;
  branchLabel?: string;
  annotationColor?: string;
  hostKey?: HostKey;
};

function compactRecency(ts: number | null | undefined): string {
  if (ts === null || ts === undefined) return "";
  const d = compactDelta(Date.now() - ts);
  if (d.kind === "unknown") return DASH;
  if (d.unit === "s") return "now";
  return `${d.value}${d.unit}`;
}

const KindTag: Component<{ kind: ResultKind }> = (props) => {
  const label =
    props.kind === "terminal" ? "term" : props.kind === "host" ? "host" : "cmd";
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

const TerminalLead: Component<{
  id: TerminalId;
  meta: TerminalMetadata;
  hostKey?: HostKey;
}> = (props) => {
  const store = useTerminalStore();
  const onActiveHost = () =>
    !props.hostKey || sameHost(props.hostKey, activeHost());
  const pip = useStatePip(
    () => encodeHostKey(props.hostKey ?? activeHost()),
    () => props.id,
    () => props.meta,
    () => onActiveHost() && store.isUnread(props.id),
  );
  return <StatePip {...pip()} class={TITLE_PIP_BOX} />;
};

const HostLead: Component<{ host: HostKey }> = (props) => {
  const state = () => padiMap.entry(props.host).state();
  const kaval = useHostKavalChain(props.host);
  return (
    <span
      class={`inline-block h-2 w-2 rounded-full shrink-0 ${dotClass(state(), kaval())}`}
      aria-hidden="true"
    />
  );
};

const TerminalHostChip: Component<{ host: HostKey }> = (props) => {
  const state = () => padiMap.entry(props.host).state();
  const kaval = useHostKavalChain(props.host);
  return (
    <span
      data-testid="palette-host-chip"
      data-host={encodeHostAttr(props.host)}
      title={`${hostLabel(props.host)} — ${statusTitle(state(), kaval())}`}
      class="palette-host-chip inline-flex items-center gap-1 max-w-[7.5rem] shrink-0 rounded-md border px-1.5 py-0.5 font-mono text-[0.62rem] text-fg-2"
      style={{ "--host-hue": hostHue(props.host) }}
    >
      <span
        class={`inline-block h-1.5 w-1.5 rounded-full shrink-0 ${dotClass(state(), kaval())}`}
        aria-hidden="true"
      />
      <HostIdentityLabel
        host={props.host}
        glyphClass="h-2.5 w-2.5"
        labelClass="truncate min-w-0"
      />
    </span>
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
  showKindTag: boolean;
  drillable: boolean;
  onSelect: () => void;
  onHover: () => void;
}> = (props) => {
  const row = () => props.cmd.row;
  const kind = (): ResultKind => row()?.kind ?? "command";

  const identityPrimary = (): string => {
    const r = row();
    if (r?.kind === "terminal") {
      return annotationLine(
        r.terminalMeta?.intent,
        r.branchLabel ?? props.cmd.name,
      );
    }
    if (r?.kind === "host" && r.hostKey) return hostLabel(r.hostKey);
    return props.cmd.name;
  };

  const contextLine = (): string => {
    const r = row();
    if (r?.kind === "terminal") {
      if (r.terminalMeta?.intent) return r.branchLabel ?? "";
      if (r.terminalMeta) return rowSubline(r.terminalMeta).text;
      if (r.context) return r.context;
      return props.cmd.description ?? "";
    }
    if (r?.kind === "host" && r.hostKey) {
      if (r.context !== undefined) return r.context;
      return hostRowContext(
        padiMap.entry(r.hostKey).state(),
        sameHost(r.hostKey, activeHost()),
      );
    }
    return props.cmd.description ?? "";
  };

  const recencyLabel = (): string => {
    if (kind() !== "terminal") return "";
    return compactRecency(row()?.recencyAt);
  };

  const foreignHost = (): HostKey | undefined => {
    const r = row();
    if (r?.kind !== "terminal" || !r.hostKey) return undefined;
    if (sameHost(r.hostKey, activeHost())) return undefined;
    return r.hostKey;
  };

  const terminalRepo = (): { name: string; color: string } | undefined => {
    const r = row();
    if (r?.kind !== "terminal" || !r.repoName || !r.repoColor) return undefined;
    return { name: r.repoName, color: r.repoColor };
  };

  return (
    <div
      role="option"
      tabIndex={-1}
      aria-selected={props.selected}
      data-selected={props.selected || undefined}
      data-palette-kind={kind()}
      data-palette-name={props.cmd.name}
      data-host={row()?.hostKey ? encodeHostAttr(row()!.hostKey!) : undefined}
      class="flex items-center gap-2 py-1.5 pr-2.5 text-[0.86rem] rounded-lg cursor-pointer transition-colors duration-100 min-w-0"
      classList={{
        "bg-accent/[0.14] text-fg shadow-[inset_0_0_0_1px_color-mix(in_oklch,var(--color-accent)_38%,transparent)]":
          props.selected,
        "text-fg-2 hover:bg-surface-2/50": !props.selected,
        "repo-spine pl-2": !!terminalRepo(),
        "pl-2.5": !terminalRepo(),
      }}
      style={
        terminalRepo() ? { "--repo-color": terminalRepo()!.color } : undefined
      }
      onMouseEnter={() => props.onHover()}
      onClick={() => props.onSelect()}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          props.onSelect();
        }
      }}
    >
      <span class="shrink-0 w-4 inline-flex items-center justify-center">
        <Show
          when={
            kind() === "terminal" && row()?.terminalId && row()?.terminalMeta
          }
        >
          <TerminalLead
            id={row()!.terminalId!}
            meta={row()!.terminalMeta!}
            hostKey={row()?.hostKey}
          />
        </Show>
        <Show when={kind() === "host" && row()?.hostKey}>
          {(host) => <HostLead host={host()} />}
        </Show>
        <Show when={kind() === "command"}>
          <CommandLead icon={props.cmd.icon} selected={props.selected} />
        </Show>
      </span>

      <div class="flex items-center gap-1.5 min-w-0 shrink">
        <Show when={terminalRepo()}>
          {(repo) => (
            <>
              <RepoMonogram
                group={repo().name}
                color={repo().color}
                size="sm"
                data-testid="palette-repo-monogram"
              />
              <span
                class="repo-name-ink font-mono text-[0.72rem] font-semibold truncate max-w-[7rem]"
                data-testid="palette-repo-name"
              >
                {repo().name}
              </span>
            </>
          )}
        </Show>
        <span
          class="annotation-ink truncate min-w-0"
          style={
            row()?.annotationColor
              ? { "--annotation-color": row()!.annotationColor }
              : undefined
          }
          data-testid="palette-branch"
        >
          <Show
            when={kind() === "terminal" && row()?.terminalMeta?.intent}
            fallback={
              <HighlightedText text={identityPrimary()} query={props.query} />
            }
          >
            <IntentMarkdownInline markdown={identityPrimary()} />
          </Show>
        </span>
      </div>

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

      <span class="ml-auto shrink-0 flex items-center gap-1.5">
        <Show when={foreignHost()}>
          {(host) => <TerminalHostChip host={host()} />}
        </Show>
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
