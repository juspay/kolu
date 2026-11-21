/** A MEMBER TERMINAL'S MARK — the any-host mark (`HostTerminalPip`) while the
 *  terminal is here, and, for one this browser has no record of right now
 *  (gone, its host down, still loading), an empty box: the rows it sits in
 *  keep their columns, and the words beside it say why. */

import { StatePip } from "@kolu/solid-statepip";
import { TITLE_PIP_BOX } from "@kolu/solid-statepip/pipVariant";
import { type Component, Show } from "solid-js";
import type { FleetTerminalStanding } from "../palette/fleetTerminals";
import HostTerminalPip from "../terminal/HostTerminalPip";
import type { MemberRef } from "./memberRef";

const MemberPip: Component<{
  /** The terminal, by its ENCODED host and its id. */
  at: MemberRef;
  standing: FleetTerminalStanding | undefined;
}> = (props) => (
  <Show
    when={props.standing?.kind === "here" ? props.standing.meta : undefined}
    fallback={<StatePip variant="empty" class={TITLE_PIP_BOX} />}
  >
    {(meta) => (
      <HostTerminalPip host={props.at.host} id={props.at.id} meta={meta()} />
    )}
  </Show>
);

export default MemberPip;
