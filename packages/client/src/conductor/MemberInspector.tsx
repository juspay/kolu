/** WHAT IS ABOUT ONE TERMINAL, under its row in a work's Details — the Right
 *  panel's own parts for that terminal, on its own host: the agent card,
 *  Compose, and the foreground process.
 *
 *  Handed a terminal that is up and holding its PTY, as the Right panel's
 *  parts are: the row decides that (`WorkTerminals`'s `unfoldable`), and a
 *  row with nothing to unfold offers no unfold button at all.
 *
 *  Compose is keyed by the row (the row is keyed by the terminal's ref), so
 *  its draft is the terminal's own, as it is in the Right panel. */

import type { ActiveTerminal } from "@kolu/padi-client/surface";
import { decodeHostKey } from "kolu-common/hostKey";
import { type Component, Show } from "solid-js";
import AgentStatusCard from "../right-panel/AgentStatusCard";
import ComposeSection from "../right-panel/ComposeSection";
import Section from "../ui/Section";
import type { MemberRef } from "./memberRef";

const MemberInspector: Component<{
  at: MemberRef;
  /** The terminal's live record. */
  arm: ActiveTerminal;
}> = (props) => (
  <div
    data-testid="work-member-inspector"
    class="col-span-full mt-1 overflow-hidden rounded-md border border-edge bg-surface-1"
  >
    <Show when={props.arm.agent}>
      {(agent) => <AgentStatusCard agent={agent()} />}
    </Show>
    <Section title="Compose">
      <ComposeSection
        host={decodeHostKey(props.at.host)}
        terminalId={props.at.id}
      />
    </Section>
    <Show when={props.arm.foreground}>
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
  </div>
);

export default MemberInspector;
