/** A MEMBER TERMINAL'S STATUS INDICATOR — the Dock's own, for a terminal on
 *  ANY host: who is driving it (the agent's mark, or `#` for a shell), its
 *  state's paint and motion, and the amber corner for a ping not yet opened.
 *
 *  Nothing here decides what the indicator says. It is bound by the binder
 *  every kolu `StatePip` reads (`useStatePip`), handed the terminal's own host
 *  so its attention comes off THAT host's frame, and its unread mark is read
 *  from that host's saved record — the record the host's Dock reads — so a
 *  terminal on a host you are not looking at shows what its own Dock shows.
 *
 *  A terminal this browser has no record of right now (gone, its host down,
 *  still loading) has nothing to paint: the box stays, empty, so the rows it
 *  sits in keep their columns, and the words beside it say why. */

import { StatePip } from "@kolu/solid-statepip";
import { TITLE_PIP_BOX } from "@kolu/solid-statepip/pipVariant";
import type { TerminalMetadata } from "@kolu/padi-client/surface";
import type { TerminalId } from "kolu-common/surface";
import { type Component, Show } from "solid-js";
import { attentionRecordOf } from "../attention/savedAttention";
import type { FleetTerminalStanding } from "../palette/fleetTerminals";
import { useStatePip } from "../terminal/statePipBind";
import type { MemberRef } from "./memberRef";

/** The bound indicator, in its own owner: the binder's memo lives as long as
 *  the record it reads. */
const BoundPip: Component<{
  host: string;
  id: TerminalId;
  meta: TerminalMetadata;
}> = (props) => {
  const pip = useStatePip(
    () => props.host,
    () => props.id,
    () => props.meta,
    () => attentionRecordOf(props.host).isUnread(props.id),
  );
  return <StatePip {...pip()} class={TITLE_PIP_BOX} />;
};

const MemberPip: Component<{
  /** The terminal, by its ENCODED host and its id. */
  at: MemberRef;
  standing: FleetTerminalStanding | undefined;
}> = (props) => (
  <Show
    when={props.standing?.kind === "here" ? props.standing.meta : undefined}
    fallback={<StatePip variant="empty" class={TITLE_PIP_BOX} />}
  >
    {(meta) => <BoundPip host={props.at.host} id={props.at.id} meta={meta()} />}
  </Show>
);

export default MemberPip;
