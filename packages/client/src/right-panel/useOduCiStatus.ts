/**
 * The Inspector's odu CI readout — the ONE wire-bound source for it.
 *
 * padi folds odu's board down to the focused terminal's checkout and publishes
 * a full-replacement frame; this is the subscription that reads it. It is
 * SHOWN-GATED (`usePanelShown`), which is what makes "no dial while nobody is
 * looking" true end to end: padi's odu session dials the daemon on its first
 * subscriber and lets the link go on its last, and the Inspector tab stays
 * MOUNTED while hidden — so without this gate a closed panel would keep the
 * session alive (and an odu-less machine would keep probing a socket nobody
 * asked about).
 *
 * It is also the reason a non-odu user sees nothing at all: the frame's
 * `kind: "none"` arm is what padi answers when the daemon is not running or the
 * checkout has no runs, and this hook floors it to `null` so the section renders
 * no chip and no disclosure.
 *
 * The stream is the fused ACTIVE-HOST reach (`hostScoped.streams`), like the
 * Code tab's change pulses: the Inspector describes the focused pane, which
 * lives on the active host, so a host switch must re-key the readout with it.
 */

import type { CiStatusFrame } from "@kolu/padi-client/surface";
import type { TerminalId } from "kolu-common/surface";
import type { Accessor } from "solid-js";
import { activeHost, activePadiStreams, interpretClientError } from "../wire";
import { usePanelShown } from "./panelShown";

/** The focused terminal's odu CI readout, or `null` when odu has nothing to say
 *  about its checkout (or the panel is not shown). */
export function useOduCiStatus(
  terminalId: Accessor<TerminalId | null>,
): Accessor<CiStatusFrame | null> {
  const shown = usePanelShown();
  const sub = activePadiStreams.ciStatus.use(
    () => {
      const id = terminalId();
      // `null` is "do not subscribe": no panel, or no focused pane.
      return id === null || !shown() ? null : { terminalId: id };
    },
    {
      // A `StreamSpec` declares no error policy on the spec, so the use site
      // supplies one — through the ONE interpreter, like every other stream
      // (`scopedSub`: the shown host toasts, a background host logs).
      onError: (err) =>
        interpretClientError(
          { kind: "scopedSub", label: "odu CI status" },
          err,
          {
            key: activeHost(),
          },
        ),
    },
  );
  return () => sub() ?? null;
}
