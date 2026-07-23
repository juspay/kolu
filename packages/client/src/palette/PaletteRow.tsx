/** Shared four-slot palette row — lead · identity · context · right rail.
 *
 *  Every result kind fills the same slots so a mixed root list stays scannable:
 *  terminal (StatePip + repo eyebrow + branch + intent + recency + `term`),
 *  host (connection dot + user@host + status + `host`),
 *  command (glyph/icon + name + description + keybind + drill chevron + `cmd`).
 *
 *  Kind tags appear only during cross-kind root search (`showKindTag`); scoped
 *  drill-ins drop them as noise. */

import type { TerminalMetadata } from "@kolu/padi/surface";
import { StatePip } from "@kolu/solid-statepip";
import { TITLE_PIP_BOX } from "@kolu/solid-statepip/pipVariant";
import { encodeHostKey, type HostKey } from "kolu-common/hostKey";
import type { TerminalId } from "kolu-common/surface";
import { type Component, createMemo, For, Show } from "solid-js";
import { Dynamic } from "solid-js/web";
import { rowSubline } from "../canvas/dock/rowSubline";
import type { PaletteCommand, PaletteLabel } from "../CommandPalette";
import {
  dotClass,
  hostHue,
  hostLabel,
  hostRowContext,
  sameHost,
  statusTitle,
} from "../host/hostChipTone";
import { HostIdentityLabel } from "../host/HostIdentityLabel";
import { formatKeybind, type Keybind } from "../input/keyboard";
import { IntentMarkdownInline } from "../intent/IntentMarkdown";
import { annotationLine } from "../intent/text";
import { bindStatePip, useStatePip } from "../terminal/statePipBind";
import { useTerminalStore } from "../terminal/useTerminalStore";
import { compactDelta } from "../time/duration";
import Kbd from "../ui/Kbd";
import { activeHost, padiMap } from "../wire";
import HighlightedText from "./highlightMatch";
import type { ResultKind } from "./rootIndex";

function encodeHostAttr(h: HostKey): string {
  return encodeHostKey(h);
}

export type PaletteRowMeta = {
  kind: ResultKind;
  /** Multi-field AND-token corpus (terminal dock fields / host label+status). */
  searchText?: string;
  recencyAt?: number | null;
  terminalId?: TerminalId;
  /** Meta snapshot for fleet rows (may be off the active host). */
  terminalMeta?: TerminalMetadata;
  /** Precomputed context (intent / foreground only — never the host name). */
  context?: string;
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

/** StatePip lead — live activity when the terminal is on the active host;
 *  pure bind from the row's meta snapshot for other hosts (activity store is
 *  active-host-only). */
const TerminalLead: Component<{
  id: TerminalId;
  meta: TerminalMetadata;
  hostKey?: HostKey;
}> = (props) => {
  const store = useTerminalStore();
  const onActiveHost = () =>
    !props.hostKey || sameHost(props.hostKey, activeHost());
  // Active-host path: full activity/unread bind.
  const livePip = useStatePip(
    () => props.id,
    () => props.meta,
    () => (onActiveHost() ? store.isUnread(props.id) : false),
  );
  const staticPip = createMemo(() =>
    bindStatePip({
      meta: props.meta,
      isLive: false,
      isFinished: false,
      unread: false,
    }),
  );
  return (
    <StatePip
      {...(onActiveHost() ? livePip() : staticPip())}
      class={TITLE_PIP_BOX}
    />
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

/** Compact host chip for cross-host terminal rows — same visual language as the
 *  chrome-bar host strip: identity hue + connection-status dot + hostLabel.
 *  One deliberate place; never also written into the context line. */
const TerminalHostChip: Component<{ host: HostKey }> = (props) => {
  const state = () => padiMap.entry(props.host).state();
  return (
    <span
      data-testid="palette-host-chip"
      data-host={encodeHostAttr(props.host)}
      title={`${hostLabel(props.host)} — ${statusTitle(state())}`}
      class="inline-flex items-center gap-1 max-w-[7.5rem] shrink-0 rounded-md border border-edge/70 px-1.5 py-0.5 font-mono text-[0.62rem] text-fg-2 bg-surface-2/40"
      style={{ "--host-hue": hostHue(props.host) }}
    >
      <span
        class={`host-hue-ring inline-block h-1.5 w-1.5 rounded-full shrink-0 ${dotClass(state())}`}
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
  /** Kind tags only during cross-kind root search. */
  showKindTag: boolean;
  drillable: boolean;
  onSelect: () => void;
  onHover: () => void;
}> = (props) => {
  const row = () => props.cmd.row;
  const kind = (): ResultKind => row()?.kind ?? "command";

  /** Same headline rule as Dock cards/list: intent line-1 when set, else
   *  branch (`annotationLine` — the Dock's single derivation). */
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
      // Host is the right-rail chip only — never here.
      // When intent owns the headline, demote branch into context (Dock
      // keeps branch off the headline in the same case). Otherwise the
      // Dock subline (agent summary / foreground).
      if (r.terminalMeta?.intent) return r.branchLabel ?? "";
      if (r.terminalMeta) return rowSubline(r.terminalMeta);
      if (r.context) return r.context;
      return props.cmd.description ?? "";
    }
    if (r?.kind === "host" && r.hostKey) {
      // Prefer explicit context from hostRootActions / Terminals headers
      // (may be "" when connected+quiet). Fall back only for unstamped rows.
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

  /** Host chip only when the terminal lives on a non-active host. */
  const foreignHost = (): HostKey | undefined => {
    const r = row();
    if (r?.kind !== "terminal" || !r.hostKey) return undefined;
    if (sameHost(r.hostKey, activeHost())) return undefined;
    return r.hostKey;
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

      {/* 2 · Identity */}
      <div class="flex items-baseline gap-1.5 min-w-0 shrink">
        <Show when={kind() === "terminal" && row()?.repoName}>
          <span
            class="font-mono text-[0.72rem] font-semibold truncate max-w-[7rem]"
            style={{ color: row()?.repoColor }}
          >
            {row()?.repoName}
          </span>
        </Show>
        <span class="truncate min-w-0">
          <Show
            when={
              kind() === "terminal" &&
              row()?.terminalMeta?.intent &&
              props.query.trim().length === 0
            }
            fallback={
              <HighlightedText text={identityPrimary()} query={props.query} />
            }
          >
            {/* Dock's identity path — safe inline markdown for intent headlines. */}
            <IntentMarkdownInline markdown={identityPrimary()} />
          </Show>
        </span>
      </div>

      {/* 3 · Context — one truncating line, never wraps. No host text. */}
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

      {/* 4 · Right rail — host chip (foreign only) · recency · keybind · kind · › */}
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
