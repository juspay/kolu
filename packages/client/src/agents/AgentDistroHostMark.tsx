/** A host tab's agents mark: agent-distro's logo right after the host name, with
 *  the host's agent state as its treatment (the fold is `agentMarkOf`):
 *
 *   - ready: the mark in the tab's own text colour — and while a newer set
 *     downloads there (the old one still serves), the same ring filling with
 *     bytes, never the first-download treatment;
 *   - downloading: a thin ring around it, filled by bytes done over total;
 *   - failed: the mark in the warning colour, with a warning dot;
 *   - checking (connected, no status yet): the mark dimmed, a spinning arc;
 *   - none (agents off, or no bake): nothing — the tab is exactly as without.
 *
 *  Hover says it in words (a bar and the bytes while downloading); a click opens
 *  Settings without switching the tab. */

import type { HostKey } from "kolu-common/hostKey";
import { type Component, createMemo, Match, Show, Switch } from "solid-js";
import { openSettings } from "../settings/useSettingsOpen";
import Tip from "../ui/Tip";
import AgentDistroLogo from "@kolu/agent-distro/solid";
import {
  type AgentMark,
  agentMarkLabel,
  agentMarkWords,
} from "@kolu/agent-distro/status";
import { agentsWhere, hostAgentMark } from "./useAgentDistro";

/** The ring: r=10 in a 24 box, so its length is 2π·10. */
const RING = 2 * Math.PI * 10;

/** The bytes a mark is filling with — a first download's, or an update's on
 *  a ready host — or `undefined` when nothing is coming down. */
function filling(
  mark: AgentMark,
):
  | { readonly fraction: number; readonly bytes: string | undefined }
  | undefined {
  if (mark.kind === "downloading") return mark;
  if (mark.kind === "ready") return mark.update?.download;
  return undefined;
}

const Ring: Component<{ mark: AgentMark }> = (props) => (
  <svg
    viewBox="0 0 24 24"
    aria-hidden="true"
    class="pointer-events-none absolute -inset-0.5 h-[22px] w-[22px] -rotate-90"
  >
    <circle
      cx="12"
      cy="12"
      r="10"
      fill="none"
      stroke-width="2"
      // The track: the tab's text colour, faint — reads on light and dark chrome.
      style={{ stroke: "color-mix(in oklch, currentColor 14%, transparent)" }}
    />
    <Switch>
      <Match when={filling(props.mark)}>
        {(m) => (
          <circle
            cx="12"
            cy="12"
            r="10"
            fill="none"
            stroke-width="2"
            stroke-linecap="round"
            class="stroke-accent"
            stroke-dasharray={`${RING}`}
            stroke-dashoffset={`${RING * (1 - m().fraction)}`}
          />
        )}
      </Match>
      <Match when={props.mark.kind === "checking"}>
        {/* One third of the ring, spinning — still under reduced motion. */}
        <circle
          cx="12"
          cy="12"
          r="10"
          fill="none"
          stroke-width="2"
          stroke-linecap="round"
          class="stroke-accent origin-center animate-spin motion-reduce:animate-none"
          stroke-dasharray={`${RING / 3} ${RING}`}
        />
      </Match>
    </Switch>
  </svg>
);

/** The words beside the mark on hover — `agentMarkWords`', the one wording —
 *  and, while downloading, a 90px bar with the bytes after it. */
const MarkTip: Component<{ mark: AgentMark; where: string }> = (props) => (
  <Show
    when={filling(props.mark)}
    fallback={
      <span class="block max-w-sm whitespace-pre-line">
        {agentMarkLabel(props.mark, props.where)}
      </span>
    }
  >
    {(m) => (
      <span class="flex items-center gap-1.5">
        <span>
          {props.mark.kind === "ready"
            ? agentMarkWords(props.mark, props.where)?.detail.join(" ")
            : agentMarkWords(props.mark, props.where)?.title}
        </span>
        {/* The same bar as the Settings status lines: 5px, radius 3, on edge. */}
        <span class="h-[5px] w-[90px] shrink-0 overflow-hidden rounded-[3px] bg-edge">
          <span
            class="block h-full bg-accent"
            style={{ width: `${m().fraction * 100}%` }}
          />
        </span>
        <Show when={m().bytes}>
          {(bytes) => <span class="font-mono text-fg-3">{bytes()}</span>}
        </Show>
      </span>
    )}
  </Show>
);

const AgentDistroHostMark: Component<{
  host: HostKey;
  /** Rendered inside the strip's hidden measuring row: same box, so the strip
   *  counts its width, but no `data-testid` and no tooltip. */
  measuring?: boolean;
}> = (props) => {
  const mark = createMemo(() => hostAgentMark(props.host));
  /** Who the words are about: this machine, or the remote host by name. */
  const where = () => agentsWhere(props.host);
  const box = () => (
    <button
      type="button"
      data-testid={props.measuring ? undefined : "host-agents-mark"}
      data-state={mark().kind}
      data-update={(() => {
        const m = mark();
        if (m.kind !== "ready" || m.update === undefined) return undefined;
        return m.update.download === undefined ? "checking" : "downloading";
      })()}
      aria-label={agentMarkLabel(mark(), where())}
      tabIndex={props.measuring ? -1 : undefined}
      onClick={(e) => {
        // The mark sits inside the tab: opening Settings must not switch host.
        e.stopPropagation();
        openSettings();
      }}
      class="pointer-events-auto relative -ml-1 mr-2.5 grid h-[18px] w-[18px] shrink-0 cursor-pointer place-items-center rounded transition-colors hover:bg-fg/10"
      classList={{
        "text-warning": mark().kind === "failed",
        "opacity-[0.55]": mark().kind === "checking",
      }}
    >
      <Show when={filling(mark()) !== undefined || mark().kind === "checking"}>
        <Ring mark={mark()} />
      </Show>
      <AgentDistroLogo size={13} />
      <Show when={mark().kind === "failed"}>
        {/* The warning dot, haloed in the strip's own background. */}
        <span
          aria-hidden="true"
          class="absolute -right-0.5 -top-0.5 h-[7px] w-[7px] rounded-full bg-warning"
          style={{ "box-shadow": "0 0 0 2px var(--color-surface-0)" }}
        />
      </Show>
    </button>
  );
  return (
    <Show when={mark().kind !== "none"}>
      <Show when={!props.measuring} fallback={box()}>
        <Tip
          label={<MarkTip mark={mark()} where={where()} />}
          class="flex items-center"
        >
          {box()}
        </Tip>
      </Show>
    </Show>
  );
};

export default AgentDistroHostMark;
