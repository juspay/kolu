/** A TERMINAL'S MARK, FOR A TERMINAL ON ANY HOST — the Dock's status mark
 *  (`StatePip`), bound by the binder every kolu surface reads (`useStatePip`)
 *  with the terminal's own host, so its attention comes off THAT host's frame,
 *  and with its unread mark read from that host's saved record — the record
 *  that host's Dock reads (`attention/savedAttention.ts`). A terminal on a host
 *  you are not looking at shows what its own Dock shows.
 *
 *  The one drawing of it: the command palette's terminal rows and the
 *  Conductor's member terminals both use this. */

import { StatePip } from "@kolu/solid-statepip";
import { TITLE_PIP_BOX } from "@kolu/solid-statepip/pipVariant";
import type { TerminalMetadata } from "@kolu/padi-client/surface";
import type { TerminalId } from "kolu-common/surface";
import type { Component } from "solid-js";
import { attentionRecordOf } from "../attention/savedAttention";
import { useStatePip } from "./statePipBind";

const HostTerminalPip: Component<{
  /** The ENCODED host key the terminal lives on. */
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

export default HostTerminalPip;
