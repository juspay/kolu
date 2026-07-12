/** HostSelectorStrip — the multi-host selector, the visible face of the keyed padi
 *  host map (W4 "the switch").
 *
 *  Multi-host is NO LONGER gated on `KOLU_PADI_HOST` — the old server-authored
 *  `hostMapGate` cell is gone entirely: every pool member gets a chip and the
 *  trailing "+ add a host" affordance is ALWAYS present. Remote hosts is an
 *  ALPHA feature, so that warning rides the "+" popover (`AddHostAffordance`)
 *  rather than an env gate. With no seed the pool is just the local host, so the
 *  resting strip is one chip + "+". (`KOLU_PADI_HOST` still works as an optional
 *  launch-time SEED — see `parseKoluPadiHostSeed`.)
 *
 *  Host-first: each host tab carries a FIXED-width dual-daemon slot
 *  (`HostDualDaemonSlot`) filled with THAT host's Padi + Kaval marks (active
 *  and inactive alike — so a red remote is obvious without switching first).
 *  Tab selection/accent marks the active host — size never does — so a host
 *  switch reflows nothing. Measure-row twins leave the slot empty so width is
 *  reserved without a second live mount.
 *
 *  Each chip reads, at a glance:
 *    · the host label (LOCAL_HOST shows a house glyph + "local" — a role, not a
 *      hostname; remotes show their `user@host`), ellipsized to a narrower
 *      max-width below the `lg` breakpoint (a window-resize-driven stage, never
 *      host-switch-driven);
 *    · a connection dot colored from the map's `EntryStatus` FACT — green ONLY for
 *      `connected` (which `connectSurfaceMap` floors on real transport liveness, so a
 *      green-over-a-dead-link dot is unrenderable, the same discipline `<HostStatusPip>`
 *      enforces for a surface's `health()`; a map entry's equivalent fact is its
 *      `EntryStatus`, not a `SurfaceHealth`, so we color from that) — NEVER hidden,
 *      at any width;
 *    · an urgency badge — the host's `awaiting` count (its FIRST client consumer), hidden
 *      when zero;
 *    · the dual-daemon slot (this host's Padi + Kaval marks);
 *    · a remove ✕ for GUEST hosts (never LOCAL_HOST) → `client.hosts.remove` (an
 *      UnremovableHostError surfaces LOUD via toast, never a silent no-op) — visible
 *      dimmed at rest above `lg`; below `lg` it hides at rest (still reachable via
 *      hover/focus, `HostChip`'s `max-lg:opacity-0`) so a crowded narrow strip doesn't
 *      spend width on chrome most of the time.
 *  A click switches the canvas (a synchronous signal write — `useEntry(activeHost)`
 *  re-keys, no reload).
 *
 *  NARROW-WINDOW STAGES (window resize only, never a host switch). Note this
 *  component only ever LIVES at `>= sm` (640px) — `useMobile.ts`'s
 *  `layoutMode` swaps `ChromeBar` out for an entirely different phone chrome
 *  below that, so `sm` is this file's point of extinction, not a stage
 *  inside it:
 *   1. (Quiet Kolu mark — IdentityRail.)
 *   2. Host names ellipsize tighter, ✕ goes hover-only, below `lg` (above).
 *   3. `md..lg` and up: once the chip row's measured content would overflow
 *      its available width, `computeVisibleHosts` (hostOverflow.ts) keeps
 *      the active chip + as many others as fit, in pool order, and folds
 *      the rest into a trailing "⋯ +N" host switcher (`HostOverflowMenu`) —
 *      click an entry to switch. Strictly one row, fixed height: no wrap, no
 *      clip, no scroll (the old `overflow-x-auto` scroll fallback is
 *      retired).
 *   4. `sm..md` — this component's actual narrowest LIVE range: the whole
 *      row collapses to `HostDropdownSwitcher` — one chip showing the
 *      active host (still carrying the dual-daemon fill), opening an
 *      anchored host switcher panel.
 *
 *  A trailing "+ add" opens the `AddHostAffordance` popover (alpha notice + doc
 *  link + ssh input) → `client.hosts.add`. */

import { createMediaQuery } from "@solid-primitives/media";
import { createResizeObserver } from "@solid-primitives/resize-observer";
import {
  decodeHostKey,
  encodeHostKey,
  type HostKey,
  parseHostInput,
} from "kolu-common/hostKey";
import {
  type Component,
  createEffect,
  createMemo,
  createSignal,
  For,
  onCleanup,
  Show,
} from "solid-js";
import { createStore } from "solid-js/store";
import { Portal } from "solid-js/web";
import { toast } from "solid-sonner";
import { ATTENTION_PILL_CLASS } from "@kolu/solid-statepip/pipVariant";
import { HomeIcon, SearchIcon } from "../ui/Icons";
import { surface } from "../ui/Surface";
import { useCommandPalette } from "../useCommandPalette";
import { type AnchorSide, useAnchoredPopover } from "../ui/useAnchoredPopover";
import {
  dotClass,
  hostHue,
  hostLabel,
  sameHost,
  statusLabelShort,
  statusTitle,
} from "./hostChipTone";
import { HostDualDaemonSlot } from "./HostDaemonChips";
import { computeVisibleHosts, type HostFit } from "./hostOverflow";
import {
  activeHost,
  client,
  onHostMembershipError,
  padiMap,
  requestActivateOnJoin,
  setActiveHost,
} from "../wire";

/** kolu.dev doc the alpha "+ add a host" popover links to. */
const REMOTE_HOSTS_DOC = "https://kolu.dev/remote-hosts/";

/** A host's on-screen identity: a house glyph (LOCAL only) immediately before
 *  its role word, glyph first — so the local chip reads as a role ("the machine
 *  kolu runs on"), not a hostname you might mistake for a machine literally
 *  named "local" (a remote's `user@host` is unambiguous already, so it gets no
 *  glyph). The single owner of the glyph+label pairing, so every visual site
 *  renders it identically and a new render site can't silently split or drop it.
 *  `labelClass` styles the label `<span>` (truncation/max-width vary per site). */
const HostIdentityLabel: Component<{ host: HostKey; labelClass?: string }> = (
  props,
) => (
  <>
    <Show when={props.host.kind === "local"}>
      <HomeIcon class="h-3 w-3 shrink-0 opacity-70" />
    </Show>
    <span class={props.labelClass}>{hostLabel(props.host)}</span>
  </>
);

/** First-frame guess for a chip's width before the measuring row's
 *  ResizeObserver lands real DOM widths (jsdom/async). Independent of the
 *  dual-daemon slot CSS — measurement is truth; this only avoids dumping
 *  every chip into overflow on the very first paint. */
// Includes dual-daemon slot = two `w-7` marks (`w-14` / 56px) + label + padding.
const FIRST_FRAME_CHIP_WIDTH_GUESS: number = 156;

/** Tailwind `md` (768px) — chip row vs dropdown. Real Solid media signal so
 *  only ONE dual-daemon fill mounts (CSS `hidden` does not unmount). */
const atMd = createMediaQuery("(min-width: 48rem)");
/** The "⋯ +N" overflow trigger's own rendered width + gap — reserved from
 *  the fit budget only once chips don't all fit (see `hostOverflow.ts`). */
const OVERFLOW_TRIGGER_RESERVE: number = 44;
/** The "+ add a host" affordance's own rendered width (`w-8` = 32px) plus the
 *  strip's `gap-1.5` (6px) that separates it from the chip row — always reserved
 *  from the fit budget now that the "+" is always present. */
const ADD_BUTTON_RESERVE: number = 38;

// The explicit type annotation on `labelForKey` (rather than inferring off the
// arrow function) is load-bearing, not decorative: this file's per-chip
// `.cells.urgency.use(...)` call (inside `HostChip`, properly owned by that
// component's own reactive instance — no `createRoot` needed) sits textually
// close to whichever top-level `const` happens to precede `HostChip`.
// `standingSubscriptionOwnership.test.ts`'s heuristic flags any UNTYPED
// top-level `const NAME = ` (its signal for "possibly a bare standing
// subscription") and scans a fixed window past it — an untyped
// `const labelForKey = (key) => ...` before `HostChip` would fold that
// unrelated per-chip `.use()` into its window. Typing the identifier
// (`const NAME: T = ...`) makes it visibly a plain value/helper, not a
// candidate the heuristic needs to inspect.
/** Decode-then-label in one step — used wherever a component only has the
 *  CANONICAL encoded string (an overflowed/menu
 *  key), never a `HostKey` object. */
const labelForKey: (key: string) => string = (key) =>
  hostLabel(decodeHostKey(key));

const statusLabel: (host: HostKey) => string = (host) =>
  statusLabelShort(padiMap.entry(host).state());

const removeHost: (host: HostKey) => void = (host) => {
  client.hosts
    .remove({ host })
    .catch((err: Error) =>
      toast.error(`Couldn't remove ${hostLabel(host)}: ${err.message}`),
    );
};

const HostChip: Component<{ host: HostKey; measure?: boolean }> = (props) => {
  // The PURE lens per chip (the host is fixed for this chip's lifetime — the `<For>`
  // gives each chip its own reactive owner, disposed when the host leaves the pool).
  const state = () => padiMap.entry(props.host).state();
  const isLocal = () => props.host.kind === "local";
  const urgency = padiMap.entry(props.host).cells.urgency.use({
    onError: (err: Error) =>
      toast.error(
        `Host ${hostLabel(props.host)} urgency error: ${err.message}`,
      ),
  });
  const awaiting = () => urgency.value()?.awaitingIds.length ?? 0;
  // The active-host signal + this chip's own host are compared by their CANONICAL
  // string (`sameHost`) — a `HostKey` is an object with no reference identity across
  // independent decodes, so `===` would silently never match a logically-equal remote.
  const isActive = () => sameHost(activeHost(), props.host);
  // Layout: [ host tab label | Padi·Kaval | ✕ ]
  // The host name button and daemon marks share one visual shell, but stay
  // sibling controls inside it. There is no `overflow-hidden`, so daemon hover
  // and focus rings can paint outside the shell instead of being clipped.
  //
  // UNIFORM SHAPE: measurable SIZE never depends on `isActive()` — only
  // border/bg/text COLOR. Dual-daemon slot is fixed width always.
  return (
    <div
      class="group -mb-px flex items-center shrink-0 text-xs"
      data-testid="host-chip"
      data-host={encodeHostKey(props.host)}
      data-active={isActive() ? "" : undefined}
    >
      <div
        // No outline box: active and inactive share the SAME geometry (no
        // border, no 1px hop on selection), and selection is carried entirely
        // by colour + a soft glow — `.host-tab-active` paints a hue-tinted
        // belly + hue underline + a downward glow that bleeds into the canvas
        // (pulled through the baseline by the wrapper's `-mb-px`), never a
        // hard ring. `--host-hue` is this host's identity colour (`hostHue`),
        // read by the active-tab CSS and the dot's hue ring. It's a pure style
        // value — no layout effect — so the measure twin still measures the
        // same width. The focus-ring is gated to keyboard, never mouse.
        class="host-tab relative flex h-8 items-center has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-accent/50 has-[:focus-visible]:ring-inset"
        style={{ "--host-hue": hostHue(props.host) }}
        classList={{
          "host-tab-active": isActive(),
          "host-tab-idle": !isActive(),
        }}
      >
        <button
          type="button"
          role="tab"
          aria-selected={isActive()}
          class="pointer-events-auto flex h-8 items-center gap-1.5 rounded-tl-xl pl-2.5 pr-2 transition-colors focus-visible:outline-none cursor-pointer"
          classList={{
            "text-fg": isActive(),
            "text-fg-2 hover:text-fg": !isActive(),
          }}
          data-testid="host-select"
          // A no-op click on the ALREADY-active chip must not re-set `activeHost`: `props.host`
          // is a FRESH object every membership read (`entries.use().keys()` decodes anew), so a
          // guardless write would replace `activeHost`'s value with a new-reference-but-equal
          // `HostKey` — `createSignal`'s default `===` equality treats that as a genuine change
          // and re-notifies every `useEntry(activeHost)` consumer for nothing. Compare by the
          // SAME canonical-string equality `isActive()` already uses (never `===` on the object).
          onClick={() => {
            if (!isActive()) setActiveHost(props.host);
          }}
          title={`${hostLabel(props.host)} — ${statusTitle(state())}`}
        >
          <span
            // Status tone (`dotClass`) fills the dot; the `host-hue-ring`
            // wraps it in this host's identity colour (`--host-hue` from the
            // tab above) — status and identity on one mark, neither hiding the
            // other.
            class={`host-hue-ring inline-block h-2 w-2 rounded-full shrink-0 ${dotClass(state())}`}
            aria-hidden="true"
          />
          {/* Ellipsizes to a NARROWER max-width below `lg` (narrow-window stage
           *  2) — a pure CSS breakpoint, so it only ever moves on a window
           *  resize, never a host switch. */}
          <HostIdentityLabel
            host={props.host}
            labelClass="truncate max-w-[5rem] lg:max-w-[10rem] font-medium"
          />
          {/* Urgency badge — the host's awaiting count, hidden at zero. */}
          <Show when={awaiting() > 0}>
            <span
              // The awaiting-count pill — the pixel REFERENCE for the amber
              // "needs you" cue. Its fill + shape + numerals are the shared
              // `ATTENTION_PILL_CLASS` (the single styling source the Dock's
              // unread badge also consumes); only the count-pill sizing is local.
              class={`${ATTENTION_PILL_CLASS} shrink-0 min-w-4 px-1 h-4`}
              title={`${awaiting()} awaiting your input`}
            >
              {awaiting()}
            </span>
          </Show>
        </button>
        <div
          class="flex h-8 items-center transition-colors"
          classList={{ "rounded-tr-xl": isLocal() }}
        >
          <HostDualDaemonSlot
            host={props.host}
            mode={props.measure ? "measure" : "interactive"}
          />
        </div>
        {/* Remove — guest only, inside the same host shell so it reads as
         *  a trailing host action, not a detached button. Dimmed at rest
         *  above `lg`; hover/focus reveals at every width. */}
        <Show when={!isLocal()}>
          <button
            type="button"
            class="pointer-events-auto shrink-0 h-8 w-6 inline-flex items-center justify-center rounded-tr-xl text-fg-3 hover:text-danger hover:bg-danger/10 opacity-45 max-lg:opacity-0 group-hover:opacity-100 focus-visible:opacity-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/50 transition-[opacity,color,background-color] cursor-pointer"
            data-testid="host-remove"
            aria-label={`Remove host ${hostLabel(props.host)}`}
            title={`Remove ${hostLabel(props.host)}`}
            onClick={() => removeHost(props.host)}
          >
            ✕
          </button>
        </Show>
      </div>
    </div>
  );
};

/** One row inside the overflow/narrow host switcher. The daemon marks are
 *  status-only here: the row is transient and must not own daemon dialogs that
 *  disappear as soon as host switching changes the visible/overflow split. */
const HostSwitcherRow: Component<{
  hostKey: string;
  onPicked: () => void;
  testIdPrefix: string;
}> = (props) => {
  const host = decodeHostKey(props.hostKey);
  const isLocal = () => host.kind === "local";
  const isActive = () => sameHost(activeHost(), host);
  const state = () => padiMap.entry(host).state();
  const urgency = padiMap.entry(host).cells.urgency.use({
    onError: (err: Error) =>
      toast.error(`Host ${hostLabel(host)} urgency error: ${err.message}`),
  });
  const awaiting = () => urgency.value()?.awaitingIds.length ?? 0;
  const pickHost = () => {
    if (!isActive()) setActiveHost(host);
    props.onPicked();
  };

  return (
    <div
      class="group/host-row relative grid grid-cols-[minmax(0,1fr)_auto_auto] items-center gap-1.5 rounded-lg p-1.5 pl-2.5 transition-colors"
      classList={{
        "bg-accent/20 ring-2 ring-accent/65": isActive(),
        "bg-surface-1/55 ring-1 ring-edge/70 hover:bg-surface-2/85 hover:ring-edge-bright/80":
          !isActive(),
      }}
      data-active={isActive() ? "" : undefined}
    >
      <Show when={isActive()}>
        <span
          class="absolute left-0 top-1.5 bottom-1.5 w-1 rounded-r-full bg-accent"
          aria-hidden="true"
        />
      </Show>
      <button
        type="button"
        data-testid={`${props.testIdPrefix}-option-${props.hostKey}`}
        aria-current={isActive() ? "true" : undefined}
        title={`${hostLabel(host)} — ${statusTitle(state())}`}
        class="pointer-events-auto flex min-w-0 items-center gap-2 rounded-md px-1.5 py-1 text-left transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/50 cursor-pointer"
        onClick={pickHost}
      >
        <span
          class={`inline-block h-2 w-2 rounded-full shrink-0 ${dotClass(state())}`}
          aria-hidden="true"
        />
        <span class="min-w-0 flex-1">
          <span
            class="flex min-w-0 items-center gap-1.5 text-xs font-medium"
            classList={{ "text-fg": isActive(), "text-fg-2": !isActive() }}
          >
            <HostIdentityLabel host={host} labelClass="truncate" />
            <Show when={isActive()}>
              <span class="shrink-0 rounded-full border border-accent/45 bg-accent/15 px-1.5 text-[9px] font-semibold leading-4 text-accent">
                active
              </span>
            </Show>
          </span>
          <span
            class="block truncate text-[10px] leading-3"
            classList={{
              "text-accent": isActive(),
              "text-fg-3": !isActive(),
            }}
          >
            {statusLabel(host)}
          </span>
        </span>
        <Show when={awaiting() > 0}>
          <span
            class="shrink-0 min-w-4 px-1 h-4 inline-flex items-center justify-center rounded-full bg-amber-500/90 text-[10px] font-semibold text-black/80 tabular-nums"
            title={`${awaiting()} awaiting your input`}
          >
            {awaiting()}
          </span>
        </Show>
      </button>
      <button
        type="button"
        class="rounded-lg shadow-[inset_0_0_0_1px_var(--color-edge)] cursor-pointer"
        classList={{
          "bg-surface-0/70": isActive(),
          "bg-surface-0/45": !isActive(),
        }}
        aria-label={`Switch to ${hostLabel(host)}`}
        title={`Switch to ${hostLabel(host)}`}
        onClick={pickHost}
      >
        <HostDualDaemonSlot host={host} mode="static" />
      </button>
      <Show when={!isLocal()} fallback={<span class="h-7 w-6" />}>
        <button
          type="button"
          class="pointer-events-auto h-7 w-6 inline-flex items-center justify-center rounded-lg text-fg-3 opacity-60 transition-[opacity,color,background-color] hover:bg-danger/10 hover:text-danger group-hover/host-row:opacity-100 focus-visible:opacity-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/50 cursor-pointer"
          data-testid={`${props.testIdPrefix}-remove-${props.hostKey}`}
          aria-label={`Remove host ${hostLabel(host)}`}
          title={`Remove ${hostLabel(host)}`}
          onClick={() => removeHost(host)}
        >
          ✕
        </button>
      </Show>
    </div>
  );
};

const hostSwitcherChrome = surface({
  radius: "lg",
  shadow: "light",
  portalled: true,
});

/** Anchored host switcher panel shared by the overflow trigger and the narrow
 *  active-host trigger. Rows keep switch actions in one place; daemon marks are
 *  read-only status hints. */
const HostSwitcherPopover: Component<{
  triggerRef: () => HTMLElement | undefined;
  open: () => boolean;
  onDismiss: () => void;
  anchor?: AnchorSide;
  hostKeys: readonly string[];
  testIdPrefix: string;
}> = (props) => {
  const { panelRef, panelStyle } = useAnchoredPopover({
    triggerRef: props.triggerRef,
    open: props.open,
    onDismiss: props.onDismiss,
    anchor: props.anchor ?? "bottom-start",
    panelMinWidth: 352,
  });

  return (
    <Show when={props.open()}>
      <Portal>
        <div
          ref={panelRef}
          data-testid={`${props.testIdPrefix}-menu`}
          class={`fixed z-50 w-[min(22rem,calc(100vw-1rem))] p-1.5 ${hostSwitcherChrome.class}`}
          style={{ ...panelStyle(), ...hostSwitcherChrome.style }}
        >
          <div class="max-h-[min(22rem,calc(100vh-4rem))] space-y-1 overflow-y-auto">
            <For each={props.hostKeys}>
              {(hostKey) => (
                <HostSwitcherRow
                  hostKey={hostKey}
                  onPicked={props.onDismiss}
                  testIdPrefix={props.testIdPrefix}
                />
              )}
            </For>
          </div>
        </div>
      </Portal>
    </Show>
  );
};

/** The trailing "⋯ +N" trigger for chips the fit computation couldn't seat —
 *  an anchored host switcher for the overflowed hosts; picking one switches.
 *
 *  Takes CANONICAL encoded keys (not `HostKey` objects) — `props.hosts` is
 *  `hostFit().overflowed` straight from `computeVisibleHosts`, and staying with
 *  its string identity all the way to `HostSwitcherPopover`'s own `<For>` matters:
 *  `<For>` keys by `===`, and every `HostKey` decode mints a fresh object,
 *  so decoding a level higher would make the menu's own option list
 *  needlessly re-key whenever anything upstream re-renders. */
const HostOverflowMenu: Component<{ hosts: string[] }> = (props) => {
  const [open, setOpen] = createSignal(false);
  let triggerEl: HTMLButtonElement | undefined;

  return (
    <>
      <button
        type="button"
        ref={triggerEl}
        data-testid="host-overflow-trigger"
        class="pointer-events-auto shrink-0 h-8 px-2 inline-flex items-center gap-1 rounded-md bg-transparent text-xs text-fg-3 transition-colors hover:bg-surface-1/60 hover:text-fg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/50 cursor-pointer"
        aria-label={`${props.hosts.length} more host${props.hosts.length === 1 ? "" : "s"}`}
        title={props.hosts.map(labelForKey).join(", ")}
        onClick={() => setOpen((v) => !v)}
      >
        ⋯ +{props.hosts.length}
      </button>
      <HostSwitcherPopover
        triggerRef={() => triggerEl}
        open={open}
        onDismiss={() => setOpen(false)}
        hostKeys={props.hosts}
        testIdPrefix="host-overflow"
      />
    </>
  );
};

/** Narrow multi-host range (`sm..md`): one bordered unit — select trigger +
 *  dual-daemon slot for the active host (same composition shape as `HostChip`,
 *  without per-host chips). The host switcher lists every pool host. */
const HostDropdownSwitcher: Component<{ hosts: HostKey[] }> = (props) => {
  const [open, setOpen] = createSignal(false);
  let triggerEl: HTMLButtonElement | undefined;
  const active = () => activeHost();
  const hostKeys = () => props.hosts.map(encodeHostKey);

  return (
    <>
      <div
        role="tablist"
        aria-label="Hosts"
        class="-mb-px flex h-8 items-center rounded-t-md border border-accent/55 border-b-transparent bg-accent/12 text-fg shadow-sm has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-accent/50 shrink-0"
        data-testid="host-dropdown-switcher"
      >
        <button
          type="button"
          role="tab"
          aria-selected="true"
          aria-expanded={open()}
          ref={triggerEl}
          class="pointer-events-auto flex h-8 items-center gap-1.5 rounded-tl-md pl-2 pr-2 text-xs text-fg transition-colors focus-visible:outline-none cursor-pointer"
          aria-label={`Switch host — currently ${hostLabel(active())}`}
          title={`Switch host — currently ${hostLabel(active())}`}
          onClick={() => setOpen((v) => !v)}
        >
          <span
            class={`inline-block h-2 w-2 rounded-full shrink-0 ${dotClass(padiMap.entry(active()).state())}`}
            aria-hidden="true"
          />
          <HostIdentityLabel
            host={active()}
            labelClass="truncate max-w-[5rem] font-medium"
          />
          <span aria-hidden="true" class="text-fg-3">
            ▾
          </span>
        </button>
        <div class="flex h-8 items-center rounded-tr-md">
          <Show keyed when={active()}>
            {(host) => <HostDualDaemonSlot host={host} />}
          </Show>
        </div>
      </div>
      <HostSwitcherPopover
        triggerRef={() => triggerEl}
        open={open}
        onDismiss={() => setOpen(false)}
        hostKeys={hostKeys()}
        testIdPrefix="host-switcher"
      />
    </>
  );
};

const addHostChrome = surface({
  radius: "lg",
  shadow: "light",
  portalled: true,
});

/** The "+ add a host" affordance — always present now that multi-host is
 *  ungated. Remote hosts is an ALPHA feature, so clicking "+" opens an anchored
 *  popover that LEADS with that notice + a kolu.dev link before the ssh-target
 *  input (the old inline input is gone). Enter commits via `client.hosts.add`;
 *  the canvas jumps to the new host once it joins membership. */
export const AddHostAffordance: Component = () => {
  const [open, setOpen] = createSignal(false);
  const [draft, setDraft] = createSignal("");
  let triggerEl: HTMLButtonElement | undefined;
  let inputEl: HTMLInputElement | undefined;
  const { panelRef, panelStyle } = useAnchoredPopover({
    triggerRef: () => triggerEl,
    open,
    onDismiss: () => setOpen(false),
    // Left-anchored (opens rightward from the "+"): the "+" sits just after the
    // chips on the LEFT of the strip, so `bottom-end` (right-align) would push
    // the panel off-screen left. `bottom-start` + panelMinWidth is the
    // viewport-clamped variant.
    anchor: "bottom-start",
    panelMinWidth: 288,
  });
  // Focus the input the frame the popover mounts it (the ref isn't attached on
  // the tick `open()` flips, so defer past mount; `isConnected` guards a
  // dismiss that beats the microtask).
  createEffect(() => {
    if (!open()) return;
    queueMicrotask(() => {
      if (inputEl?.isConnected) inputEl.focus({ preventScroll: true });
    });
  });
  const submit = (): void => {
    const raw = draft().trim();
    if (raw === "") return;
    // `parseHostInput` is TOTAL (typing "local" just parses to the Local
    // variant, already a pool member); `hosts.add`'s own rejection is the
    // honest single error surface.
    const host = parseHostInput(raw);
    client.hosts
      .add({ host })
      .then(() => {
        setDraft("");
        setOpen(false);
        // Jump to the new host once it JOINS membership — a bare setActiveHost
        // here races the reconcile and bounces back to local.
        requestActivateOnJoin(host);
      })
      .catch((err: Error) =>
        toast.error(`Couldn't add ${raw}: ${err.message}`),
      );
  };
  return (
    <>
      <button
        type="button"
        ref={triggerEl}
        data-testid="host-add-open"
        class="pointer-events-auto shrink-0 h-8 w-8 inline-flex items-center justify-center rounded-lg text-fg-3 transition-colors hover:bg-surface-1/60 hover:text-fg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/50 cursor-pointer"
        aria-label="Add a host"
        title="Add a host (ssh target)"
        aria-expanded={open()}
        onClick={() => setOpen((v) => !v)}
      >
        +
      </button>
      <Show when={open()}>
        <Portal>
          <div
            ref={panelRef}
            data-testid="host-add-menu"
            class={`fixed z-50 w-[min(20rem,calc(100vw-1rem))] p-3 ${addHostChrome.class}`}
            style={{ ...panelStyle(), ...addHostChrome.style }}
          >
            <div class="mb-1.5 flex items-center gap-1.5">
              <span class="shrink-0 rounded-full border border-amber-500/40 bg-amber-500/15 px-1.5 text-[9px] font-semibold uppercase leading-4 tracking-wide text-amber-600 dark:text-amber-400">
                Alpha
              </span>
              <span class="text-xs font-semibold text-fg">Remote hosts</span>
            </div>
            <p class="mb-2.5 text-[11px] leading-4 text-fg-2">
              Connecting other machines over ssh is an early feature.{" "}
              <a
                href={REMOTE_HOSTS_DOC}
                target="_blank"
                rel="noopener noreferrer"
                class="text-accent hover:underline"
              >
                Learn more →
              </a>
            </p>
            <input
              ref={inputEl}
              type="text"
              data-testid="host-add-input"
              class="pointer-events-auto h-8 w-full rounded-lg border border-edge bg-surface-1 px-2.5 text-xs text-fg placeholder:text-fg-3 transition-colors focus:border-accent/50 focus:bg-surface-2 focus:outline-none"
              placeholder="ssh host, e.g. srid@zest"
              value={draft()}
              onInput={(e) => setDraft(e.currentTarget.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") submit();
                if (e.key === "Escape") setOpen(false);
              }}
            />
          </div>
        </Portal>
      </Show>
    </>
  );
};

/** The host-bar search affordance — a magnifier that opens the `Switch host`
 *  palette group (the same `⌘⇧H` fuzzy picker), mirroring the Dock's workspace
 *  search button. Only rendered when the pool holds more than the local host. */
const HostSearchButton: Component = () => {
  const commandPalette = useCommandPalette();
  return (
    <button
      type="button"
      data-testid="host-search"
      onClick={() => commandPalette.openGroup("Switch host")}
      class="pointer-events-auto shrink-0 h-8 w-8 inline-flex items-center justify-center rounded-lg text-fg-3 transition-colors hover:bg-surface-1/60 hover:text-fg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/50 cursor-pointer"
      aria-label="Switch host"
      title="Switch host (⌘⇧H)"
    >
      <SearchIcon class="h-4 w-4" />
    </button>
  );
};

const HostSelectorStrip: Component = () => {
  const members = padiMap.entries.use({ onError: onHostMembershipError });

  // Multi-host chrome is NO LONGER gated on `KOLU_PADI_HOST`: every pool member
  // gets a chip and the "+ add a host" affordance is always present (the alpha
  // warning rides the "+" popover — see AddHostAffordance). With no seed the
  // pool is just the local host, so this renders exactly the local chip + "+".
  const renderableHosts = (): HostKey[] => [...members.keys()];

  // ── Overflow fit (narrow-window stage 3) ──────────────────────────────
  // Real DOM measurement: a HIDDEN row (absolutely positioned, `invisible`,
  // `pointer-events-none`, so it never paints or intercepts a click) mounts
  // every renderable host's `HostChip` a second time purely to read its
  // natural rendered width via a `ResizeObserver`. `hostOverflow.ts`'s
  // `computeVisibleHosts` is the pure decision function; this component only
  // supplies its two reactive inputs (per-chip widths, the row's own
  // available width).
  let containerRef: HTMLDivElement | undefined;
  const [containerWidth, setContainerWidth] = createSignal(0);
  createResizeObserver(
    () => containerRef,
    (rect) => setContainerWidth(rect.width),
  );

  const [chipWidths, setChipWidths] = createStore<Record<string, number>>({});
  const [measureRefs, setMeasureRefs] = createStore<
    Record<string, HTMLDivElement | undefined>
  >({});
  createResizeObserver(
    () =>
      Object.values(measureRefs).filter(
        (el): el is HTMLDivElement => el !== undefined,
      ),
    (rect, el) => {
      const key = el.dataset.hostKey;
      if (key) setChipWidths(key, rect.width);
    },
  );

  const chipFits = createMemo<HostFit[]>(() =>
    renderableHosts().map((h) => {
      const key = encodeHostKey(h);
      return { key, width: chipWidths[key] ?? FIRST_FRAME_CHIP_WIDTH_GUESS };
    }),
  );
  // The "+ add a host" affordance is always present now, so its width is always
  // reserved from the chips' fit budget.
  const chipsBudget = createMemo(() => containerWidth() - ADD_BUTTON_RESERVE);
  // `hostFit()` returns fresh `{visible, overflowed}` arrays of CANONICAL string
  // keys on every recompute (it re-runs whenever `activeHost()` changes, even
  // when the outcome is identical). Rendering directly off those STRINGS
  // (never decoding to `HostKey` objects before a `<For>`) is deliberate:
  // `<For>` keys items by `===`, and a `HostKey` decode mints a fresh object
  // every call — decoding upstream of `<For>` would make every host switch
  // tear down and rebuild every `HostChip` (and its live subscriptions) even
  // when the visible SET didn't change, defeating the whole point of this
  // file. Each `HostChip` decodes its OWN key exactly once, inside its own
  // `<For>` item callback, so the resulting `HostKey` stays referentially
  // stable for that chip's lifetime.
  const hostFit = createMemo(() =>
    computeVisibleHosts(
      chipFits(),
      encodeHostKey(activeHost()),
      chipsBudget(),
      OVERFLOW_TRIGGER_RESERVE,
    ),
  );

  return (
    <div
      ref={containerRef}
      // `flex-1` is LOAD-BEARING, not decorative: ChromeBar's wrapper around
      // this component is itself `flex-1 min-w-0` so it fills the header's
      // leftover space regardless of content — but a flex item WITHOUT its
      // own `flex-grow` sizes to its CONTENT, not to that leftover space
      // (flex-shrink only caps it downward when content overflows; it never
      // grows to fill when content is narrower). Without `flex-1` here, this
      // root's own `getBoundingClientRect().width` — what `containerWidth`
      // above measures — would just echo back whatever `hostFit()` already chose
      // to render, a circular "available width" that can never grow back
      // once narrowed. `flex-1` makes this box == the header's true leftover
      // space, independent of content, so the overflow computation has a
      // real budget to fit chips against.
      class="host-strip pointer-events-auto relative flex h-8 flex-1 items-end gap-1.5 min-w-0"
      data-testid="host-selector-strip"
    >
      {/* `md` and up vs `sm..md`: mount ONLY one layout (media signal, not
       *  CSS-only hide). Both used to stay mounted with `hidden md:flex` /
       *  `md:hidden`, which double-filled dual-daemon slots on the active
       *  host. Split is keyed on `md` (768px), not `sm` — ChromeBar never
       *  mounts below `sm` (phone chrome). */}
      <Show
        when={atMd()}
        fallback={<HostDropdownSwitcher hosts={renderableHosts()} />}
      >
        <div
          role="tablist"
          aria-label="Hosts"
          class="flex items-end gap-1.5 min-w-0 flex-nowrap"
          data-testid="host-chip-row"
        >
          <For each={hostFit().visible}>
            {(key) => <HostChip host={decodeHostKey(key)} />}
          </For>
          <Show when={hostFit().overflowed.length > 0}>
            <HostOverflowMenu hosts={hostFit().overflowed} />
          </Show>
        </div>
      </Show>

      {/* Hidden measuring row — off-screen (position absolute, so it never
       *  affects this container's own layout), invisible + inert, mounts
       *  every renderable host's chip a second time purely so its natural
       *  width can be read via the `ResizeObserver` above. NOTE for a future
       *  e2e author: this row is always mounted, so `[data-testid="host-chip"]`
       *  matches TWICE per host — the real (visible) one and this hidden twin. `aria-hidden` + `pointer-events-none` keep it out of
       *  the accessibility tree and unclickable, and Playwright's
       *  visibility-aware actions (`.click()`) skip it, but a bare
       *  `.count()`/`.all()` would not — scope any such query under
       *  `[data-testid="host-chip-row"]` (or the dropdown switcher) to reach
       *  only the real one. */}
      <div
        aria-hidden="true"
        class="invisible pointer-events-none absolute left-0 top-0 flex items-center gap-1.5"
      >
        <For each={renderableHosts()}>
          {(host) => {
            const key = encodeHostKey(host);
            onCleanup(() => setMeasureRefs(key, undefined));
            return (
              <div
                ref={(el) => setMeasureRefs(key, el)}
                data-host-key={key}
                class="shrink-0"
              >
                <HostChip host={host} measure />
              </div>
            );
          }}
        </For>
      </div>

      {/* Search/switch host — mirrors the Dock's search button, opens the
       *  `⌘⇧H` picker. Only meaningful with more than one host in the pool. */}
      <Show when={renderableHosts().length > 1}>
        <HostSearchButton />
      </Show>

      {/* Add a host at runtime — always present now (no `KOLU_PADI_HOST` gate);
       *  the alpha warning rides its popover. */}
      <AddHostAffordance />
    </div>
  );
};

export default HostSelectorStrip;
