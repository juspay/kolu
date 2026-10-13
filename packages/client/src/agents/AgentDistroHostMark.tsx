/** A host tab's agents mark: agent-distro's logo right after the host name, with
 *  the host's agent state as its treatment (the fold is `agentMarkOf`):
 *
 *   - ready: the mark in the tab's own text colour — and while kolu delivers a
 *     newer set there (the old one still serves), a turning arc around it;
 *   - downloading (kolu delivering a first set): the same turning arc;
 *   - failed: the mark in the warning colour, with a warning dot;
 *   - checking (connected, no status yet): the mark dimmed, a turning arc;
 *   - none (agents off, or no bake): nothing — the tab is exactly as without.
 *
 *  The arc never fills: a delivery's copies report no byte counts, so it
 *  says only that one is under way. Hover says it in words; a click opens THAT
 *  machine's host details, whose agents section carries its profile, the
 *  build it serves, its last delivery, its own events and its check —
 *  without switching the tab. */

import { encodeHostKey, type HostKey } from "kolu-common/hostKey";
import { type Component, createMemo, onCleanup, Show } from "solid-js";
import {
  openHostDiagnostics,
  releaseHostDiagnosticsAnchor,
} from "../host/useHostDiagnosticsOpen";
import Tip from "../ui/Tip";
import AgentDistroLogo from "@kolu/agent-distro/solid";
import { type AgentMark, agentMarkLabel } from "@kolu/agent-distro/status";
import { agentsWhere, hostAgentMark } from "./useAgentDistro";

/** The ring: r=10 in a 24 box, so its length is 2π·10. */
const RING = 2 * Math.PI * 10;

/** Something is under way there: kolu delivering (a first set, or a newer one
 *  while the old serves), or the host's status not heard yet. */
function busy(mark: AgentMark): boolean {
  return (
    mark.kind === "downloading" ||
    mark.kind === "checking" ||
    (mark.kind === "ready" && mark.delivering)
  );
}

/** A third of a faint ring, turning — still under reduced motion. */
const Arc: Component = () => (
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
  </svg>
);

const AgentDistroHostMark: Component<{
  host: HostKey;
  /** Rendered inside the strip's hidden measuring row: same box, so the strip
   *  counts its width, but no `data-testid` and no tooltip. */
  measuring?: boolean;
}> = (props) => {
  const mark = createMemo(() => hostAgentMark(props.host));
  /** Who the words are about, named as the host tab names it. */
  const where = () => agentsWhere(props.host);
  const box = () => (
    <button
      ref={(el) => onCleanup(() => releaseHostDiagnosticsAnchor(el))}
      type="button"
      data-testid={props.measuring ? undefined : "host-agents-mark"}
      data-state={mark().kind}
      aria-label={agentMarkLabel(mark(), where())}
      tabIndex={props.measuring ? -1 : undefined}
      onClick={(e) => {
        // The mark sits inside the tab: opening the details must not switch
        // host. The panel mounts at the shell and hangs off this mark.
        e.stopPropagation();
        openHostDiagnostics(encodeHostKey(props.host), e.currentTarget);
      }}
      class="pointer-events-auto relative -ml-1 mr-2.5 grid h-[18px] w-[18px] shrink-0 cursor-pointer place-items-center rounded transition-colors hover:bg-fg/10"
      classList={{
        "text-warning": mark().kind === "failed",
        "opacity-[0.55]": mark().kind === "checking",
      }}
    >
      <Show when={busy(mark())}>
        <Arc />
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
          label={
            <span class="block max-w-sm whitespace-pre-line">
              {agentMarkLabel(mark(), where())}
            </span>
          }
          class="flex items-center"
        >
          {box()}
        </Tip>
      </Show>
    </Show>
  );
};

export default AgentDistroHostMark;
