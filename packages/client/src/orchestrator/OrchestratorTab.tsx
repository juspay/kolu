/** `◆ Orchestrator` — the conversation's own entry in the chrome bar.
 *
 *  It sits in the same row as the host tabs and is deliberately NOT one of
 *  them. A host tab is a browser-tab shape with a connection dot, the host's
 *  own hue and a "+" beside its group, because a host is a machine whose
 *  reachability you watch; the orchestrator is one conversation that reaches
 *  every machine, with no connection of its own to report. So this is a PILL,
 *  pinned at the end of the row after a separator: same row, visibly a
 *  different kind of thing — the chrome-bar pill of `orchestrator-ux.html`.
 *
 *  It is not a host anywhere else either: no host key, no entry in the host
 *  map, nothing in the host switcher's data model. Selecting it enters
 *  orchestrator mode; selecting any host tab leaves it; `⌘⇧O` does both.
 *
 *  Its badge is the violet needs-you count — the questions the one
 *  conversation is blocked on, across every host it has terminals on. ABSENT
 *  at zero, never a `0`: a badge that renders its own silence is one every
 *  reader has to parse before ignoring. */

import { type Component, Show } from "solid-js";
import { ACTIONS } from "../input/actions";
import { formatKeybind } from "../input/keyboard";
import Tip from "../ui/Tip";
import { orchestratorAsksTotal } from "./useOrchestratorFacts";
import {
  enterOrchestratorMode,
  exitOrchestratorMode,
  orchestratorMode,
} from "./useOrchestratorMode";

const OrchestratorTab: Component = () => (
  <div class="flex shrink-0 items-center gap-2 pointer-events-auto">
    {/* The separator IS the "not a host tab" statement, so it is not
     *  decoration: the host tabs end here and the row's one special
     *  destination begins. */}
    <span aria-hidden="true" class="h-4 w-px shrink-0 bg-edge" />
    <Tip
      label={`Orchestrator (${formatKeybind(ACTIONS.toggleOrchestrator.keybind)})`}
    >
      <button
        type="button"
        data-testid="orchestrator-tab"
        data-active={orchestratorMode() ? "" : undefined}
        aria-pressed={orchestratorMode()}
        class="relative flex h-7 shrink-0 items-center gap-1.5 rounded-lg border px-2.5 font-mono text-[0.65rem] font-semibold cursor-pointer transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/50"
        classList={{
          "border-accent/60 bg-accent/12 text-accent": orchestratorMode(),
          "border-edge text-fg-3 hover:bg-surface-2 hover:text-fg":
            !orchestratorMode(),
        }}
        onClick={() =>
          orchestratorMode() ? exitOrchestratorMode() : enterOrchestratorMode()
        }
      >
        ◆ Orchestrator
        <Show when={orchestratorAsksTotal() > 0}>
          <span
            data-testid="orchestrator-badge"
            class="absolute -top-1 -right-1 rounded-full bg-alert px-1.5 font-mono text-[0.6rem] font-bold text-surface-0"
          >
            {orchestratorAsksTotal()}
          </span>
        </Show>
      </button>
    </Tip>
  </div>
);

export default OrchestratorTab;
