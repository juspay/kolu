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
 *  only for `connected`), `hostHue` for the per-host identity accent,
 *  `HostAwaitingPill` (violet needs-you count) and `HostFinishedDot` (amber
 *  unseen-finished) — so a dot / hue / pill means the same thing on a phone as
 *  on a laptop. A tap calls `setActiveHost` (the identical write the desktop
 *  strip makes; W9 makes the switch instant). Adding a host reuses the shared
 *  `addHost` mechanism; only the CONTAINER differs from desktop — a full-width
 *  in-sheet section rather than an anchored popover (the popover clips at
 *  phone width).
 *
 *  Touch ergonomics: every chip and the add trigger are ≥44px hit targets, and
 *  the chip row scrolls horizontally when hosts overflow the viewport width. */

import { encodeHostKey, type HostKey } from "kolu-common/hostKey";
import {
  type Component,
  createMemo,
  createSignal,
  For,
  onMount,
  Show,
} from "solid-js";
import { activeHost, padiMap, setActiveHost } from "../wire";
import { addHost } from "./addHost";
import { focusOnMount } from "./focusOnMount";
import { HostAwaitingPill } from "./HostAwaitingPill";
import { HostFinishedDot } from "./HostFinishedDot";
import {
  dotClass,
  hostHue,
  hostLabel,
  sameHost,
  statusTitle,
} from "./hostChipTone";
import { HostIdentityLabel } from "./HostIdentityLabel";
import { hostMarks } from "../attention/attentionMarks";
import { useHostMembers } from "./useHostMembers";

/** One touch chip for a host — a ≥44px hit target; tap switches the canvas. */
const MobileHostChip: Component<{ host: HostKey; onSwitch: () => void }> = (
  props,
) => {
  // The host is fixed for this chip's lifetime (the `<For>` gives each chip its
  // own reactive owner, disposed when the host leaves the pool). Both derivations
  // are memoized because each is read from several tracked positions in the JSX
  // (`isActive` from aria-current + data-active + two classList keys; `state`
  // from the title + the dot class), and each read otherwise re-runs the
  // encode/membership-scan on every `activeHost`/entry change.
  const state = createMemo(() => padiMap.entry(props.host).state());
  // Compare active-host vs. this chip's host by CANONICAL string (`sameHost`),
  // never `===`: a `HostKey` is an object with no reference identity across
  // independent decodes.
  const isActive = createMemo(() => sameHost(activeHost(), props.host));
  // Both marks from the ONE store, bundled once (the host is fixed for this chip).
  const marks = hostMarks(encodeHostKey(props.host));

  return (
    <button
      type="button"
      // A host chip is a SELECTION button, not a `role="tab"`: tapping switches
      // the canvas and dismisses the sheet, it does NOT reveal an associated
      // `tabpanel`, and there's no roving-tabindex/arrow-key tab widget here. So
      // it carries `aria-current` — the SAME semantics the desktop's transient
      // host picker (`HostSwitcherRow` in `HostSelectorStrip.tsx`) already uses
      // for its list of host options, which is this row's real interaction twin
      // (a pick-and-dismiss list in a popover/sheet, not the persistent top-bar
      // tab strip). The shared VISUAL vocabulary (dot / hue / pill) is unchanged.
      aria-current={isActive() ? "true" : undefined}
      data-testid="mobile-host-chip"
      data-host={encodeHostKey(props.host)}
      data-active={isActive() ? "" : undefined}
      // 44px min hit target. The identity hue (`--host-hue`) rides the active
      // chip's border + tinted belly, quiet at rest — the same "host is a
      // place, not a label" treatment the desktop tab wears. The hue RING
      // (`host-hue-ring`) is the DOT's identity mark only (below), never the
      // whole shell — an inactive chip must stay quiet (`border-edge`), so the
      // shell itself carries no hue at rest, exactly like the desktop chip.
      class="flex min-h-[44px] shrink-0 items-center gap-2 rounded-xl border px-3 py-2 text-sm transition-colors"
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
      // the same canonical-string comparison the desktop strip uses. The guard
      // also covers `onSwitch`: closing the sheet is the "after a switch"
      // gesture, so a no-op tap on the current host leaves the sheet OPEN (it
      // isn't a switch) rather than dismissing it out from under the user.
      onClick={() => {
        if (isActive()) return;
        setActiveHost(props.host);
        props.onSwitch();
      }}
    >
      <span
        // Status tone fills the dot; the hue ring wraps it in this host's
        // identity colour — status and identity on one mark.
        class={`host-hue-ring inline-block h-2.5 w-2.5 shrink-0 rounded-full ${dotClass(state())}`}
        aria-hidden="true"
      />
      <HostIdentityLabel
        host={props.host}
        glyphClass="h-3.5 w-3.5"
        labelClass="max-w-[10rem] truncate font-medium"
      />
      {/* Needs-you pill — shared violet `HostAwaitingPill` (roomier mobile).
       *  Unseen-finished is the amber `HostFinishedDot` beside it. */}
      <HostAwaitingPill count={marks.asking()} sizeClass="h-5 min-w-5 px-1.5" />
      {/* Quiet finished-work dot — amber unseen-finished (suppressed on the
       *  active host). */}
      <HostFinishedDot
        count={marks.unseenFinished()}
        active={isActive()}
        hostLabel={hostLabel(props.host)}
        sizeClass="h-2 w-2"
      />
    </button>
  );
};

/** The in-sheet add-host SECTION — the mobile-native variant of the desktop `+`
 *  popover. A FULL-WIDTH block inside the sheet (no anchored popover to clip at
 *  phone width) with the ssh field, committing through the shared `addHost`.
 *  `onClose` collapses it on success or Escape. */
const MobileAddSection: Component<{ onClose: () => void }> = (props) => {
  const [draft, setDraft] = createSignal("");
  let inputEl: HTMLInputElement | undefined;

  // Focus the input on mount (the section mounts fresh via `<Show>`, so a plain
  // `onMount` fires exactly once) — shared timing with the desktop popover.
  onMount(() => focusOnMount(inputEl));

  const submit = (): void => addHost(draft(), props.onClose);

  return (
    <div
      data-testid="mobile-host-add-section"
      class="mt-2 rounded-xl border border-edge bg-surface-1 p-3"
      // Stop the pointerdown reaching the Corvu drawer's drag recognizer on
      // `Drawer.Content` — otherwise finger jitter on the input / Add button is
      // read as the start of a drag and can suppress the tap or move/dismiss the
      // sheet. Same guard the sheet's other controls (palette, settings) wear.
      onPointerDown={(e) => e.stopPropagation()}
    >
      <div class="flex items-center gap-2">
        <input
          ref={inputEl}
          type="text"
          data-testid="mobile-host-add-input"
          class="h-11 min-w-0 flex-1 rounded-lg border border-edge bg-surface-0 px-3 text-sm text-fg placeholder:text-fg-3 focus:border-accent/50 focus:outline-none"
          placeholder="ssh host, e.g. srid@zest"
          aria-label="ssh host"
          value={draft()}
          onInput={(e) => setDraft(e.currentTarget.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") submit();
            if (e.key === "Escape") {
              // Escape collapses ONLY this section. `preventDefault` is
              // load-bearing: Corvu's document-level Escape listener dismisses
              // the drawer only when `!event.defaultPrevented` (its
              // `createDismissible`), so without this the same keystroke would
              // also close the whole pull-down sheet.
              e.preventDefault();
              props.onClose();
            }
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
  const hosts = useHostMembers();
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
          // Plain container — NOT a `tablist` (the chips are `aria-current`
          // selection buttons, not tabs owning tabpanels) and NOT `role="group"`
          // (biome's `useSemanticElements` would push that to `<fieldset>`, which
          // is for form controls). Same shape as desktop's `HostSwitcherRow`
          // list container: a plain div whose children each carry their own
          // accessible name; the visible "Hosts" heading above labels it.
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
          // Sits OUTSIDE the chip scroller (so it stays reachable on overflow),
          // so it needs its OWN drag opt-out: stop the pointerdown before the
          // Corvu drawer reads a jittered tap as a drag-to-dismiss.
          onPointerDown={(e) => e.stopPropagation()}
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
