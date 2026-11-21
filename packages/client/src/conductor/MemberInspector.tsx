/** WHAT IS ABOUT ONE TERMINAL, under its row in a work's Details — the Right
 *  panel's own parts for that terminal, on its own host: the agent card,
 *  Compose, and the foreground process.
 *
 *  Compose is offered only for a terminal that is awake, as in the Right
 *  panel: a sleeping one has released its PTY, and a write would go nowhere.
 *  It is keyed by the row (the row is keyed by the terminal's ref), so its
 *  draft is the terminal's own, as it is in the Right panel. */

import { decodeHostKey } from "kolu-common/hostKey";
import { type Component, Show } from "solid-js";
import type { FleetTerminalStanding } from "../palette/fleetTerminals";
import AgentStatusCard from "../right-panel/AgentStatusCard";
import ComposeSection from "../right-panel/ComposeSection";
import Section from "../ui/Section";
import type { MemberRef } from "./memberRef";
import { liveArm } from "./terminalStatus";

const MemberInspector: Component<{
  at: MemberRef;
  standing: FleetTerminalStanding | undefined;
}> = (props) => {
  const arm = () =>
    props.standing === undefined ? undefined : liveArm(props.standing);
  return (
    <div
      data-testid="work-member-inspector"
      class="col-span-full mt-1 overflow-hidden rounded-md border border-edge bg-surface-1"
    >
      <Show
        when={arm()}
        fallback={
          <p class="m-0 px-3 py-2 text-[0.68rem] text-fg-3">
            This terminal is not awake: there is nothing to send to it.
          </p>
        }
      >
        {(live) => (
          <>
            <Show when={live().agent}>
              {(agent) => <AgentStatusCard agent={agent()} />}
            </Show>
            <Section title="Compose">
              <ComposeSection
                host={decodeHostKey(props.at.host)}
                terminalId={props.at.id}
              />
            </Section>
            <Show when={live().foreground}>
              {(fg) => (
                <div class="px-3 py-2 font-mono text-[10px] text-fg-3">
                  <span
                    data-testid="work-member-foreground"
                    title={fg().title ?? undefined}
                  >
                    fg <span class="text-fg-2">{fg().name}</span>
                  </span>
                </div>
              )}
            </Show>
          </>
        )}
      </Show>
    </div>
  );
};

export default MemberInspector;
