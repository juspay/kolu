import { decodeHostKey } from "kolu-common/hostKey";
import type { TerminalId } from "kolu-common/surface";
import { useDockFocus } from "../canvas/dock/useDockFocus";
import { selectHostTab } from "../host/selectHostTab";

export function useOpenTile(): (at: {
  /** The ENCODED host key the terminal lives on (`local`, `remote:…`) — the
   *  host half of a fleet ref, exactly as the cell spells it. */
  readonly host: string;
  readonly id: TerminalId;
}) => void {
  const focus = useDockFocus();
  return (at) => {
    selectHostTab(decodeHostKey(at.host));
    focus(at.id);
  };
}
