import { type Component, Show } from "solid-js";
import { ACTIONS } from "../input/actions";
import { formatKeybind } from "../input/keyboard";
import Tip from "../ui/Tip";
import { useConductorBadge } from "./useConductorFacts";
import { enterConductorMode, conductorMode } from "./useConductorMode";

const ConductorTab: Component = () => {
  const badge = useConductorBadge();
  return (
    <Tip
      label={`Conductor (${formatKeybind(ACTIONS.toggleConductor.keybind)})`}
    >
      <button
        type="button"
        data-testid="conductor-tab"
        data-active={conductorMode() ? "" : undefined}
        data-asking={badge.waiting() > 0 && !conductorMode() ? "" : undefined}
        aria-current={conductorMode() ? "page" : undefined}
        class={`host-tab conductor-tab ${conductorMode() ? "host-tab-active" : "host-tab-idle"} pointer-events-auto relative -mb-px flex h-8 shrink-0 items-center gap-1.5 px-2.5 text-xs font-semibold cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-conductor/50`}
        onClick={() => enterConductorMode()}
      >
        <span aria-hidden="true">◆</span>
        Conductor
        <span
          data-testid="conductor-alpha"
          class="rounded-sm bg-fg-3/15 px-1 py-px font-mono text-[0.58rem] font-semibold uppercase tracking-[0.08em] leading-[1.4] text-fg-3"
        >
          alpha
        </span>
        <Show when={badge.waiting() > 0}>
          <span
            data-testid="conductor-badge"
            data-asking=""
            data-waiting={badge.waiting()}
            class="absolute -top-1.5 -right-1.5 min-w-4 rounded-full bg-alert px-1 text-center text-[0.6rem] font-semibold leading-4 text-surface-0"
          >
            {badge.waiting()}
          </span>
        </Show>
      </button>
    </Tip>
  );
};

export default ConductorTab;
