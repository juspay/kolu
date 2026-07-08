/**
 * HostDownCanvas — the Skew-UX "this host's padi failed to bind" surface.
 *
 * Distinct from `DegradedCanvas` (a CONNECTED host whose kaval daemon died, which
 * offers a Restart): this is the ACTIVE host's map-membership entry itself failing
 * — an ssh/contract-level fault the map reports as a TYPED {@link EntryFailedCause}.
 * There is nothing on THIS side to restart (the remote never bound), so the one
 * action is `[Switch to local]` — never a Retry. Each cause gets first-class
 * plain-language copy from the pure {@link hostDownCopy} map; this component is a
 * thin renderer over that copy plus the switch button.
 *
 * `cause` + `reason` arrive as props from the resolved `host-failed` CanvasMode
 * (App.tsx reads them off the active entry's `state()`); the copy is looked up by
 * cause and the raw `reason` is shown verbatim as a small detail beneath it.
 */

import type { EntryFailedCause } from "kolu-common/surfacesWithPadi";
import { LOCAL_HOST } from "kolu-common/surfacesWithPadi";
import { type Component, Show } from "solid-js";
import { WarningIcon } from "../ui/Icons";
import { activeHost, setActiveHost } from "../wire";
import { hostDownCopy } from "./hostDownCopy";

const HostDownCanvas: Component<{
  cause: EntryFailedCause;
  reason: string;
}> = (props) => {
  const copy = () => hostDownCopy(props.cause);
  // The local default is unremovable and always a member, so `[Switch to local]`
  // is the always-available escape hatch — hidden only when it IS the active host
  // (switching to where you already are is a no-op).
  const isLocal = () => activeHost().kind === "local";
  return (
    <div
      data-testid="host-down-canvas"
      data-entry-cause={props.cause}
      class="relative flex-1 min-h-0 flex items-center justify-center canvas-grid-bg"
    >
      <div class="mx-6 max-w-md rounded-xl border border-warning/50 bg-warning/5 px-6 py-5">
        <div class="flex items-start gap-3">
          <WarningIcon class="mt-0.5 h-6 w-6 shrink-0 text-warning" />
          <div class="min-w-0">
            <h2 class="text-sm font-semibold text-fg">{copy().title}</h2>
            <p class="mt-1.5 text-sm leading-relaxed text-fg-2">
              {copy().body}
            </p>
            <p class="mt-2 font-mono text-xs leading-relaxed text-fg-3 break-words">
              {props.reason}
            </p>
            <Show when={!isLocal()}>
              <div class="mt-3">
                <button
                  type="button"
                  data-testid="switch-to-local"
                  onClick={() => setActiveHost(LOCAL_HOST)}
                  class="flex w-full cursor-pointer items-center justify-center gap-2 rounded-lg border border-edge bg-surface-2 px-3 py-2 text-xs font-medium text-fg transition-colors hover:bg-surface-3/60"
                >
                  Switch to local
                </button>
              </div>
            </Show>
          </div>
        </div>
      </div>
    </div>
  );
};

export default HostDownCanvas;
