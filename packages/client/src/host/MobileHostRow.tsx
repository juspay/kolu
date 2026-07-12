/** MobileHostRow — the host row for the mobile pull-down chrome sheet.
 *
 *  The touch layout drops the persistent desktop chrome bar (and its
 *  `HostSelectorStrip`), so on a phone there was no way to see, switch, or add
 *  hosts — even though the host engine underneath (the keyed padi host map, W9
 *  retained switching, W10 persisted fleet, W5 attention) is fully
 *  layout-agnostic. This row is the mobile face of that same engine, mounted at
 *  the top of `MobileChromeSheet`.
 *
 *  It is the mobile TWIN of `HostSelectorStrip`, not a restyle: a chip consumes
 *  the EXACT desktop vocabulary — `dotClass` for the connection-dot tone (green
 *  only for `connected`), `hostHue` for the per-host identity accent, and
 *  `ATTENTION_PILL_CLASS` (`@kolu/solid-statepip`) for the unread pill — so a
 *  dot / hue / pill means the same thing on a phone as on a laptop. A tap calls
 *  `setActiveHost` (the identical write the desktop strip makes; W9 makes the
 *  switch instant). Adding a host reuses the shared `addHost` mechanism; only
 *  the CONTAINER differs from desktop — a full-width in-sheet section rather
 *  than an anchored popover (the popover clips at phone width).
 *
 *  Touch ergonomics: every chip and the add trigger are ≥44px hit targets, and
 *  the chip row scrolls horizontally when hosts overflow the viewport width. */

import { encodeHostKey, type HostKey } from "kolu-common/hostKey";
import {
  type Component,
  createEffect,
  createSignal,
  For,
  Show,
} from "solid-js";
import { ATTENTION_PILL_CLASS } from "@kolu/solid-statepip/pipVariant";
import { HomeIcon } from "../ui/Icons";
import {
  activeHost,
  onHostMembershipError,
  padiMap,
  setActiveHost,
} from "../wire";
import { addHost } from "./addHost";
import {
  dotClass,
  hostHue,
  hostLabel,
  sameHost,
  statusTitle,
} from "./hostChipTone";
import { RemoteHostsAlphaNotice } from "./RemoteHostsNotice";
import { useHostAwaiting } from "./useHostAwaiting";

/** One touch chip for a host — a ≥44px hit target; tap switches the canvas. */
const MobileHostChip: Component<{ host: HostKey; onSwitch: () => void }> = (
  props,
) => {
  // The host is fixed for this chip's lifetime (the `<For>` gives each chip its
  // own reactive owner, disposed when the host leaves the pool), so these are
  // plain per-chip lenses.
  const state = () => padiMap.entry(props.host).state();
  const isLocal = () => props.host.kind === "local";
  // Compare active-host vs. this chip's host by CANONICAL string (`sameHost`),
  // never `===`: a `HostKey` is an object with no reference identity across
  // independent decodes.
  const isActive = () => sameHost(activeHost(), props.host);
  const awaiting = useHostAwaiting(props.host);

  return (
    <button
      type="button"
      role="tab"
      aria-selected={isActive()}
      data-testid="mobile-host-chip"
      data-host={encodeHostKey(props.host)}
      data-active={isActive() ? "" : undefined}
      // 44px min hit target. The identity hue (`--host-hue`) rides the active
      // chip's border + tinted belly, quiet at rest — the same "host is a
      // place, not a label" treatment the desktop tab wears.
      class="host-hue-ring flex min-h-[44px] shrink-0 items-center gap-2 rounded-xl border px-3 py-2 text-sm transition-colors"
      classList={{
        "border-[var(--host-hue)] bg-[color-mix(in_srgb,var(--host-hue)_18%,var(--color-surface-1))] text-fg":
          isActive(),
        "border-edge bg-surface-2 text-fg-2 active:bg-surface-3": !isActive(),
      }}
      style={{ "--host-hue": hostHue(props.host) }}
      title={`${hostLabel(props.host)} — ${statusTitle(state())}`}
      // A no-op tap on the already-active chip must not re-write `activeHost`
      // with a new-reference-but-equal key (it would re-notify every
      // `useEntry(activeHost)` consumer for nothing) — guard on `isActive()`,
      // the same canonical-string comparison the desktop strip uses.
      onClick={() => {
        if (!isActive()) setActiveHost(props.host);
        props.onSwitch();
      }}
    >
      <span
        // Status tone fills the dot; the hue ring wraps it in this host's
        // identity colour — status and identity on one mark.
        class={`host-hue-ring inline-block h-2.5 w-2.5 shrink-0 rounded-full ${dotClass(state())}`}
        aria-hidden="true"
      />
      <Show when={isLocal()}>
        <HomeIcon class="h-3.5 w-3.5 shrink-0 opacity-70" />
      </Show>
      <span class="max-w-[10rem] truncate font-medium">
        {hostLabel(props.host)}
      </span>
      {/* Unread pill — the host's awaiting count in the SHARED
       *  `ATTENTION_PILL_CLASS` (the Dock's badge and the desktop strip's count
       *  pill draw from the same token), hidden at zero. */}
      <Show when={awaiting() > 0}>
        <span
          class={`${ATTENTION_PILL_CLASS} h-5 min-w-5 shrink-0 px-1.5`}
          title={`${awaiting()} awaiting your input`}
        >
          {awaiting()}
        </span>
      </Show>
    </button>
  );
};

/** The in-sheet add-host SECTION — the mobile-native variant of the desktop `+`
 *  popover. A FULL-WIDTH block inside the sheet (no anchored popover to clip at
 *  phone width) carrying the same ALPHA notice and ssh field, committing
 *  through the shared `addHost`. `onClose` collapses it on success or Escape. */
const MobileAddSection: Component<{ onClose: () => void }> = (props) => {
  const [draft, setDraft] = createSignal("");
  let inputEl: HTMLInputElement | undefined;

  // Focus the input the frame the section mounts (`isConnected` guards a
  // collapse that beats the microtask).
  createEffect(() => {
    queueMicrotask(() => {
      if (inputEl?.isConnected) inputEl.focus({ preventScroll: true });
    });
  });

  const submit = (): void => addHost(draft(), props.onClose);

  return (
    <div
      data-testid="mobile-host-add-section"
      class="mt-2 rounded-xl border border-edge bg-surface-1 p-3"
    >
      <RemoteHostsAlphaNotice />
      <div class="flex items-center gap-2">
        <input
          ref={inputEl}
          type="text"
          data-testid="mobile-host-add-input"
          class="h-11 min-w-0 flex-1 rounded-lg border border-edge bg-surface-0 px-3 text-sm text-fg placeholder:text-fg-3 focus:border-accent/50 focus:outline-none"
          placeholder="ssh host, e.g. srid@zest"
          value={draft()}
          onInput={(e) => setDraft(e.currentTarget.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") submit();
            if (e.key === "Escape") props.onClose();
          }}
        />
        <button
          type="button"
          data-testid="mobile-host-add-submit"
          class="h-11 shrink-0 rounded-lg bg-accent px-4 text-sm font-semibold text-surface-0 active:bg-accent/80"
          onClick={submit}
        >
          Add
        </button>
      </div>
    </div>
  );
};

/** The full mobile host row: a horizontally-scrollable strip of host chips, the
 *  add trigger, and (when open) the in-sheet add section. `onSwitch` closes the
 *  sheet after a switch so the canvas is visible immediately. */
const MobileHostRow: Component<{ onSwitch: () => void }> = (props) => {
  const members = padiMap.entries.use({ onError: onHostMembershipError });
  const hosts = (): HostKey[] => [...members.keys()];
  const [addOpen, setAddOpen] = createSignal(false);

  return (
    <div class="border-b border-edge/50 px-3 py-2">
      <div class="mb-1.5 text-[10px] font-semibold uppercase tracking-wide text-fg-3">
        Hosts
      </div>
      {/* Row: the chips scroll horizontally on overflow; the add "+" sits
       *  OUTSIDE that scroll container so it stays reachable however many hosts
       *  there are (the desktop strip reserves the "+" the same way). */}
      <div class="flex items-center gap-2">
        <div
          role="tablist"
          aria-label="Hosts"
          data-testid="mobile-host-row"
          // Stop propagation so the Corvu drawer's drag handler can't claim a
          // horizontal swipe across the chips as a drag-to-dismiss.
          class="flex min-w-0 flex-1 items-center gap-2 overflow-x-auto pb-1"
          onPointerDown={(e) => e.stopPropagation()}
        >
          <For each={hosts()}>
            {(host) => <MobileHostChip host={host} onSwitch={props.onSwitch} />}
          </For>
        </div>
        <button
          type="button"
          data-testid="mobile-host-add-open"
          class="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl border border-dashed border-edge text-lg text-fg-3 active:bg-surface-2"
          aria-label="Add a host"
          aria-expanded={addOpen()}
          onClick={() => setAddOpen((v) => !v)}
        >
          +
        </button>
      </div>
      <Show when={addOpen()}>
        <MobileAddSection onClose={() => setAddOpen(false)} />
      </Show>
    </div>
  );
};

export default MobileHostRow;
