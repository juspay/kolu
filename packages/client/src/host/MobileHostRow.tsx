/** MobileHostRow — PROTOTYPE host row for the mobile pull-down chrome sheet.
 *
 *  The touch layout renders no host chrome: `ChromeBar` + `HostSelectorStrip`
 *  are desktop-only, so on a phone you can't see, switch, or add hosts even
 *  though the engine underneath (host map, retained switching, persisted
 *  fleet, per-host attention) is fully layout-agnostic. This row is the mobile
 *  face of the same keyed padi host map the desktop strip renders.
 *
 *  It DELIBERATELY reuses the desktop strip's vocabulary rather than restyling:
 *    · `dotClass` for the connection dot tone (green only for `connected`);
 *    · `hostHue` for the per-host identity accent (`--host-hue`);
 *    · `ATTENTION_PILL_CLASS` (@kolu/solid-statepip) for the unread pill;
 *    · `hostLabel` / `sameHost` / `statusTitle` for identity + active compare;
 *    · `AddHostAffordance` — the SAME add-host popover the desktop "+" opens.
 *
 *  Touch ergonomics: each chip is a >= 44px tall hit target and the row scrolls
 *  horizontally (`overflow-x-auto`) when hosts overflow the viewport width.
 *
 *  A tap calls `setActiveHost` — the exact call `HostSelectorStrip` makes; the
 *  switch is instant (retained-host paint). */

import { encodeHostKey, type HostKey } from "kolu-common/hostKey";
import { type Component, For, Show } from "solid-js";
import { toast } from "solid-sonner";
import { ATTENTION_PILL_CLASS } from "@kolu/solid-statepip/pipVariant";
import {
  activeHost,
  onHostMembershipError,
  padiMap,
  setActiveHost,
} from "../wire";
import {
  dotClass,
  hostHue,
  hostLabel,
  sameHost,
  statusTitle,
} from "./hostChipTone";
import { HomeIcon } from "../ui/Icons";
import { AddHostAffordance } from "./HostSelectorStrip";

/** One touch chip for a host. >= 44px tall; tap switches the canvas host. */
const MobileHostChip: Component<{ host: HostKey; onSwitch: () => void }> = (
  props,
) => {
  const state = () => padiMap.entry(props.host).state();
  const isLocal = () => props.host.kind === "local";
  const isActive = () => sameHost(activeHost(), props.host);
  const urgency = padiMap.entry(props.host).cells.urgency.use({
    onError: (err: Error) =>
      toast.error(
        `Host ${hostLabel(props.host)} urgency error: ${err.message}`,
      ),
  });
  const awaiting = () => urgency.value()?.awaitingIds.length ?? 0;

  return (
    <button
      type="button"
      role="tab"
      aria-selected={isActive()}
      data-testid="mobile-host-chip"
      data-host={encodeHostKey(props.host)}
      data-active={isActive() ? "" : undefined}
      // 44px min hit target; identity hue rides the active border via --host-hue.
      class="host-hue-ring shrink-0 flex min-h-[44px] items-center gap-2 rounded-xl border px-3 py-2 text-sm transition-colors"
      classList={{
        "border-[var(--host-hue)] bg-[color-mix(in_srgb,var(--host-hue)_16%,transparent)] text-fg":
          isActive(),
        "border-edge bg-surface-2 text-fg-2 active:bg-surface-3": !isActive(),
      }}
      style={{ "--host-hue": hostHue(props.host) }}
      title={`${hostLabel(props.host)} — ${statusTitle(state())}`}
      onClick={() => {
        if (!isActive()) setActiveHost(props.host);
        props.onSwitch();
      }}
    >
      <span
        class={`inline-block h-2.5 w-2.5 rounded-full shrink-0 ${dotClass(state())}`}
        aria-hidden="true"
      />
      <Show when={isLocal()}>
        <HomeIcon class="h-3.5 w-3.5 shrink-0 opacity-70" />
      </Show>
      <span class="truncate max-w-[10rem] font-medium">
        {hostLabel(props.host)}
      </span>
      <Show when={awaiting() > 0}>
        <span
          class={`${ATTENTION_PILL_CLASS} shrink-0 min-w-5 px-1.5 h-5`}
          title={`${awaiting()} awaiting your input`}
        >
          {awaiting()}
        </span>
      </Show>
    </button>
  );
};

/** The full mobile host row: a horizontally-scrollable strip of host chips plus
 *  the shared add-host affordance. `onSwitch` closes the sheet after a switch. */
const MobileHostRow: Component<{ onSwitch: () => void }> = (props) => {
  const members = padiMap.entries.use({ onError: onHostMembershipError });
  const hosts = (): HostKey[] => [...members.keys()];

  return (
    <div class="border-b border-edge/50 px-3 py-2">
      <div class="mb-1.5 text-[10px] font-semibold uppercase tracking-wide text-fg-3">
        Hosts
      </div>
      <div
        role="tablist"
        aria-label="Hosts"
        data-testid="mobile-host-row"
        // Horizontal scroll when hosts overflow; stop propagation so the Corvu
        // drawer's drag handler can't claim a horizontal swipe as a dismiss.
        class="flex items-center gap-2 overflow-x-auto pb-1"
        onPointerDown={(e) => e.stopPropagation()}
      >
        <For each={hosts()}>
          {(host) => <MobileHostChip host={host} onSwitch={props.onSwitch} />}
        </For>
        <AddHostAffordance />
      </div>
    </div>
  );
};

export default MobileHostRow;
