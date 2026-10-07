/** A host tab's agents mark: agent-distro's logo right after the host name, with
 *  the host's agent state as its treatment (the fold is `agentMarkOf`):
 *
 *   - ready: the mark in the tab's own text colour;
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
import { type AgentMark, agentMarkLabel } from "@kolu/agent-distro/status";
import { hostLabel } from "../host/hostChipTone";
import { hostAgentMark } from "./useAgentDistro";

/** The ring: r=10 in a 24 box, so its length is 2π·10. */
const RING = 2 * Math.PI * 10;

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
      <Match when={props.mark.kind === "downloading" && props.mark}>
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

/** The words beside the mark on hover — `agentMarkLabel`'s, the one wording
 *  (the bytes ride in it) — and, while downloading, a 90px bar. */
const MarkTip: Component<{ mark: AgentMark; where: string }> = (props) => (
  <Show
    when={props.mark.kind === "downloading" && props.mark}
    fallback={
      <span class="block max-w-sm whitespace-pre-line">
        {agentMarkLabel(props.mark, props.where)}
      </span>
    }
  >
    {(m) => (
      <span class="flex items-center gap-1.5">
        <span>{agentMarkLabel(m(), props.where)}</span>
        {/* The same bar as the Settings status lines: 5px, radius 3, on edge. */}
        <span class="h-[5px] w-[90px] shrink-0 overflow-hidden rounded-[3px] bg-edge">
          <span
            class="block h-full bg-accent"
            style={{ width: `${m().fraction * 100}%` }}
          />
        </span>
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
  const where = () =>
    props.host.kind === "local" ? "this machine" : hostLabel(props.host);
  const box = () => (
    <button
      type="button"
      data-testid={props.measuring ? undefined : "host-agents-mark"}
      data-state={mark().kind}
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
      <Show when={mark().kind === "downloading" || mark().kind === "checking"}>
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
