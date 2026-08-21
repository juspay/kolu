/** HostSelectorStrip — the multi-host selector, the visible face of the keyed padi
 *  host map (W4 "the switch").
 *
 *  Multi-host is NO LONGER gated on `KOLU_PADI_HOST` — the old server-authored
 *  `hostMapGate` cell is gone entirely: every pool member gets a chip and the
 *  trailing "+ add a host" affordance is ALWAYS present. With no seed the pool
 *  is just the local host, so the resting strip is one chip + "+".
 *  (`KOLU_PADI_HOST` still works as an optional launch-time SEED — see
 *  `parseKoluPadiHostSeed`.)
 *
 *  Host tab bar:
 *    · each pool member is a tab (active host keeps its `--host-hue` belly);
 *    · identity is Home + machine hostname (local) or ssh target (remote);
 *    · always-on connection status pip (green/amber/red) — click opens the
 *      per-host diagnostics popover; label only switches (never hover-open);
 *    · awaiting-count pill + finished-unseen amber count stay on the strip
 *      (an unseen tab also washes amber — `.host-tab[data-unseen]`);
 *    · padi/kaval detail lives in the diagnostics popover, not on the strip;
 *    · remove is in the popover with a confirm step.
 *  A click on the label switches the canvas (a synchronous signal write —
 *  `useEntry(activeHost)` re-keys, no reload).
 *
 *  NARROW-WINDOW STAGES (window resize only, never a host switch). Note this
 *  component only ever LIVES at `>= sm` (640px) — `useMobile.ts`'s
 *  `layoutMode` swaps `ChromeBar` out for an entirely different phone chrome
 *  below that, so `sm` is this file's point of extinction, not a stage
 *  inside it:
 *   1. (Quiet Kolu mark — IdentityRail.)
 *   2. Host names ellipsize tighter below `lg`.
 *   3. `md..lg` and up: once the chip row's measured content would overflow
 *      its available width, `computeVisibleHosts` (hostOverflow.ts) keeps
 *      the active chip + as many others as fit, in pool order, and folds
 *      the rest into a trailing "⋯ +N" host switcher (`HostOverflowMenu`) —
 *      click an entry to switch. Strictly one row, fixed height: no wrap, no
 *      clip, no scroll (the old `overflow-x-auto` scroll fallback is
 *      retired).
 *   4. `sm..md` — this component's actual narrowest LIVE range: the whole
 *      row collapses to `HostDropdownSwitcher` — one chip showing the
 *      active host, opening an anchored host switcher panel.
 *
 *  A trailing "+ add" opens the `AddHostAffordance` popover (ssh-target input)
 *  → `client.hosts.add`. */

import { createMediaQuery } from "@solid-primitives/media";
import { createResizeObserver } from "@solid-primitives/resize-observer";
import {
  decodeHostKey,
  encodeHostKey,
  type HostKey,
  hostKeysEqual as sameHost,
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
import { AttentionTriplet } from "@kolu/solid-statepip";
import { hostMarks } from "../attention/attentionMarks";
import { jumpToAsking } from "../attention/attentionNav";
import DocLink from "../ui/DocLink";
import { surface } from "../ui/Surface";
import { forwardsForHost } from "../forwards/useForwards";
import { type AnchorSide, useAnchoredPopover } from "../ui/useAnchoredPopover";
import { useServerIdentity } from "../useServerIdentity";
import { activeHost, padiMap, setActiveHost } from "../wire";
import { addHost } from "./addHost";
import { focusOnMount } from "./focusOnMount";
import { HostDiagnosticsPopover } from "./HostDiagnosticsPopover";
import { HostIdentityLabel } from "./HostIdentityLabel";
import { forwardRingLabel, HostStatusDot } from "./HostStatusDot";
import { activeKavalPresence } from "../kaval/useDaemonStatus";
import {
  chipStatusDot,
  hostDisplayName,
  hostGlance,
  hostHue,
  hostLabel,
  kavalChainOf,
} from "./hostChipTone";
import { useHostKavalChain } from "./useHostKaval";
import { runAction } from "../runAction";
import { computeVisibleHosts, type HostFit } from "./hostOverflow";
import { removeHost } from "./removeHost";
import { useHostMembers } from "./useHostMembers";

/** First-frame guess for a chip's width before the measuring row's
 *  ResizeObserver lands real DOM widths (jsdom/async). Measurement is truth;
 *  this only avoids dumping every chip into overflow on the very first paint.
 *  Tab: status pip + identity + attention pills. */
const FIRST_FRAME_CHIP_WIDTH_GUESS: number = 96;

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

/** Decode-then-label in one step — used wherever a component only has the
 *  CANONICAL encoded string (an overflowed/menu
 *  key), never a `HostKey` object. */
const labelForKey: (key: string) => string = (key) =>
  hostLabel(decodeHostKey(key));

/** Accessors the strip owns for the one-open-diagnostics key — passed into
 *  each chip so open state dies with the strip (no module-lifetime leak). */
type DiagnosticsCtl = {
  isOpen: (encKey: string) => boolean;
  open: (encKey: string) => void;
  close: () => void;
  toggle: (encKey: string) => void;
};

const HostChip: Component<{
  host: HostKey;
  measure?: boolean;
  diagnostics: DiagnosticsCtl;
}> = (props) => {
  // The PURE lens per chip (the host is fixed for this chip's lifetime — the `<For>`
  // gives each chip its own reactive owner, disposed when the host leaves the pool).
  const state = () => padiMap.entry(props.host).state();
  // Both host-tab attention marks — the violet "asking" pill and the amber
  // "finished, unseen" count — read from the ONE cross-host store `useAttention`
  // publishes (neither is the raw urgency count: a finished agent idles in
  // `waiting` forever). Bundled once; the host is fixed for this chip's lifetime,
  // so its key is encoded a single time.
  const encKey = encodeHostKey(props.host);
  const marks = hostMarks(encKey);
  // How many doors kolu holds open to this host — the ring on the dot below.
  const forwardCount = () => forwardsForHost(props.host).length;
  // The active-host signal + this chip's own host are compared by their CANONICAL
  // string (`sameHost`) — a `HostKey` is an object with no reference identity across
  // independent decodes, so `===` would silently never match a logically-equal remote.
  const isActive = () => sameHost(activeHost(), props.host);
  // #2101 N4: the presented state composes the daemon chain — a padi-up host
  // whose kaval is down must not paint the connected green.
  const kaval = useHostKavalChain(props.host);
  const glance = () => hostGlance(state(), kaval());
  const down = () => glance().down;
  // Always-on connection status — also the diagnostics open control.
  const statusDot = () => chipStatusDot(props.host, state(), kaval());
  const { hostname } = useServerIdentity();
  const name = () => hostDisplayName(props.host, hostname());
  // Strip-owned open key — only ONE diagnostics panel mounts at a time.
  const diagOpen = () => !props.measure && props.diagnostics.isOpen(encKey);

  let chipEl: HTMLDivElement | undefined;

  // UNIFORM SHAPE: measurable SIZE never depends on `isActive()` — only
  // border/bg/text COLOR. Identity switches; status pip opens diagnostics.
  return (
    <div
      ref={chipEl}
      class="group -mb-px flex items-center shrink-0 text-xs"
      data-testid="host-chip"
      data-host={encKey}
      data-active={isActive() ? "" : undefined}
      data-down={down() ? "" : undefined}
    >
      <div
        // Tab geometry: rounded top, flush bottom into the canvas. Active and
        // idle share the same size (no 1px hop). Active hue fill is kept even
        // when down, with `.host-tab-down` layered on.
        class="host-tab relative flex h-8 items-center has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-accent/50 has-[:focus-visible]:ring-inset"
        style={{ "--host-hue": hostHue(props.host) }}
        // Attention washes the WHOLE tab, not just the capsule inside it. Area
        // is what carries a mark into peripheral vision — a 6 px dot on a quiet
        // tab did not (#1990). Needs-you violet DOMINATES unseen amber (blocked
        // beats unopened); both suppress on the active tab so they never fight
        // the host-hue belly — the capsules still show there.
        data-asking={marks.asking() > 0 && !isActive() ? "" : undefined}
        data-unseen={
          marks.unseenFinished() > 0 && marks.asking() === 0 && !isActive()
            ? ""
            : undefined
        }
        classList={{
          "host-tab-active": isActive(),
          "host-tab-idle": !isActive() && !down(),
          "host-tab-down": down(),
        }}
      >
        {/* Connection status pip — click opens diagnostics (not switch). */}
        <button
          type="button"
          data-testid="host-diagnostics-open"
          aria-haspopup="dialog"
          aria-expanded={diagOpen()}
          aria-label={`Details for ${name()} — ${glance().title}${forwardCount() > 0 ? `, ${forwardRingLabel(forwardCount())}` : ""}`}
          title={`${glance().title} — click for details`}
          class="pointer-events-auto ml-2 flex h-7 w-4 shrink-0 items-center justify-center rounded-tl-[10px] transition-colors hover:bg-black/5 dark:hover:bg-white/5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/50 cursor-pointer"
          onClick={(e) => {
            e.stopPropagation();
            if (props.measure) return;
            props.diagnostics.toggle(encKey);
          }}
        >
          {/* The dot, ringed when kolu holds forwards to this host. The ring
           *  composes AROUND the pip and never touches its colour — see
           *  `HostStatusDot`. It replaced a `⇄ n` chip beside the label: this
           *  button is already what opens the dropdown the forward rows live
           *  in, so the count belongs in its label rather than in a second
           *  visual competing with the attention pills. */}
          <HostStatusDot
            statusDot={statusDot()}
            forwardCount={forwardCount()}
          />
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={isActive()}
          class="pointer-events-auto flex h-8 items-center gap-1.5 pl-1 pr-2.5 transition-colors focus-visible:outline-none cursor-pointer"
          classList={{
            "text-fg": isActive() && !down(),
            "text-fg-2 hover:text-fg": !isActive() && !down(),
            "text-fg-3": down(),
          }}
          data-testid="host-select"
          // Switch only. Diagnostics is the status pip.
          onClick={() => {
            if (!isActive()) setActiveHost(props.host);
          }}
          title={`${name()} — ${glance().title}`}
        >
          {/* Local: Home + machine hostname. Remote: ssh target (ellipsizes
           *  tighter below `lg`). Down: struck-through label. */}
          <HostIdentityLabel
            host={props.host}
            labelClass={`truncate max-w-[5rem] lg:max-w-[10rem] font-medium${glance().labelDecoration}`}
          />
        </button>
        {/* The attention summary — working · needs-you · unseen — the ONE
         *  triplet every altitude renders. A SIBLING of the label button (not
         *  a child) so its violet jump capsule is a real `<button>` without
         *  nesting interactive elements. Shown on the ACTIVE tab too: the
         *  summary is about the host's terminals, not about where you are —
         *  being on the host while a background terminal blocks was exactly
         *  the 20-hour failure. Unseen still suppresses on the active host
         *  (its dock rows carry that mark). */}
        <AttentionTriplet
          active={marks.active()}
          asking={marks.asking()}
          unseen={marks.unseenFinished()}
          viewing={isActive()}
          sizeClass="min-w-4 px-1 h-4"
          scopeLabel={name()}
          onAsking={() => jumpToAsking(encKey)}
          class="-ml-1 mr-2.5"
        />
      </div>
      <Show when={diagOpen()}>
        <HostDiagnosticsPopover
          host={props.host}
          triggerRef={() => chipEl}
          open={diagOpen}
          onDismiss={props.diagnostics.close}
        />
      </Show>
    </div>
  );
};

/** One row inside the overflow/narrow host switcher — same vocabulary as the
 *  strip (status pip + Home/hostname; no dual-daemon marks). */
const HostSwitcherRow: Component<{
  hostKey: string;
  onPicked: () => void;
  testIdPrefix: string;
}> = (props) => {
  const host = decodeHostKey(props.hostKey);
  const isLocal = () => host.kind === "local";
  const isActive = () => sameHost(activeHost(), host);
  const state = () => padiMap.entry(host).state();
  const kaval = useHostKavalChain(host);
  const glance = () => hostGlance(state(), kaval());
  const down = () => glance().down;
  const statusDot = () => chipStatusDot(host, state(), kaval());
  const marks = hostMarks(props.hostKey);
  const pickHost = () => {
    if (!isActive()) setActiveHost(host);
    props.onPicked();
  };

  return (
    <div
      class="group/host-row relative grid grid-cols-[minmax(0,1fr)_auto_auto] items-center gap-1.5 rounded-lg p-1.5 pl-2.5 transition-colors"
      classList={{
        "bg-accent/20 ring-2 ring-accent/65": isActive() && !down(),
        "bg-surface-1/55 ring-1 ring-edge/70 hover:bg-surface-2/85 hover:ring-edge-bright/80":
          !isActive() && !down(),
        "opacity-70 ring-1 ring-danger/40": down(),
      }}
      data-active={isActive() ? "" : undefined}
      data-down={down() ? "" : undefined}
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
        title={`${hostLabel(host)} — ${glance().title}`}
        class="pointer-events-auto flex min-w-0 items-center gap-2 rounded-md px-1.5 py-1 text-left transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/50 cursor-pointer"
        onClick={pickHost}
      >
        <span
          class={`inline-block h-2 w-2 rounded-full shrink-0 ${statusDot()}`}
          aria-hidden="true"
        />
        <span class="min-w-0 flex-1">
          <span
            class="flex min-w-0 items-center gap-1.5 text-xs font-medium"
            classList={{
              "text-fg": isActive() && !down(),
              "text-fg-2": !isActive() && !down(),
              "text-fg-3": down(),
            }}
          >
            <HostIdentityLabel
              host={host}
              labelClass={`truncate${glance().labelDecoration}`}
            />
            <Show when={isActive()}>
              <span class="shrink-0 rounded-full border border-accent/45 bg-accent/15 px-1.5 text-[9px] font-semibold leading-4 text-accent">
                active
              </span>
            </Show>
          </span>
          <span
            class="block truncate text-[10px] leading-3"
            classList={{
              "text-accent": isActive() && !down(),
              "text-fg-3": !isActive() && !down(),
              "text-danger": down(),
            }}
          >
            {glance().short}
          </span>
        </span>
      </button>
      {/* Attention summary — a sibling grid cell (not inside the switch
       *  button), so the violet jump capsule stays a real `<button>`. */}
      <AttentionTriplet
        active={marks.active()}
        asking={marks.asking()}
        unseen={marks.unseenFinished()}
        viewing={isActive()}
        sizeClass="min-w-4 px-1 h-4"
        scopeLabel={hostLabel(host)}
        onAsking={() => {
          jumpToAsking(props.hostKey);
          props.onPicked();
        }}
      />
      <Show when={!isLocal()} fallback={<span class="h-7 w-6" />}>
        <button
          type="button"
          class="pointer-events-auto h-7 w-6 inline-flex items-center justify-center rounded-lg text-fg-3 opacity-0 transition-[opacity,color,background-color] hover:bg-danger/10 hover:text-danger group-hover/host-row:opacity-100 focus-visible:opacity-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/50 cursor-pointer"
          data-testid={`${props.testIdPrefix}-remove-${props.hostKey}`}
          aria-label={`Remove host ${hostLabel(host)}`}
          title={`Remove ${hostLabel(host)}`}
          onClick={() => runAction("remove host", removeHost(host))}
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
 *  active-host trigger. Rows keep switch actions in one place; daemon detail
 *  lives on the chip diagnostics popover, not here. */
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

/** Narrow multi-host range (`sm..md`): one tab-shaped unit — the active host
 *  status pip + identity, opening an anchored host switcher. */
const HostDropdownSwitcher: Component<{ hosts: HostKey[] }> = (props) => {
  const [open, setOpen] = createSignal(false);
  let triggerEl: HTMLButtonElement | undefined;
  const active = () => activeHost();
  const state = () => padiMap.entry(active()).state();
  // The ACTIVE host's chain, read through the active-host memo rather than a
  // per-host subscription: this switcher re-points at whatever host is active, and
  // a `useHostKavalChain(active())` would have pinned the subscription to whichever
  // host happened to be active when the component mounted.
  const kaval = () => kavalChainOf(activeKavalPresence());
  const glance = () => hostGlance(state(), kaval());
  const down = () => glance().down;
  const statusDot = () => chipStatusDot(active(), state(), kaval());
  const hostKeys = () => props.hosts.map(encodeHostKey);

  return (
    <>
      <div
        role="tablist"
        aria-label="Hosts"
        class="host-tab host-tab-active -mb-px flex h-8 items-center shrink-0 has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-accent/50"
        classList={{ "host-tab-down": down() }}
        style={{ "--host-hue": hostHue(active()) }}
        data-testid="host-dropdown-switcher"
        data-down={down() ? "" : undefined}
      >
        <button
          type="button"
          role="tab"
          aria-selected="true"
          aria-expanded={open()}
          ref={triggerEl}
          class="pointer-events-auto flex h-8 items-center gap-1.5 pl-2.5 pr-2 text-xs transition-colors focus-visible:outline-none cursor-pointer"
          classList={{ "text-fg": !down(), "text-fg-3": down() }}
          aria-label={`Switch host — currently ${hostLabel(active())}`}
          title={`Switch host — currently ${hostLabel(active())}`}
          onClick={() => setOpen((v) => !v)}
        >
          <span
            class={`inline-block h-2 w-2 rounded-full shrink-0 ${statusDot()}`}
            aria-hidden="true"
          />
          <HostIdentityLabel
            host={active()}
            labelClass={`truncate max-w-[5rem] font-medium${glance().labelDecoration}`}
          />
          <span aria-hidden="true" class="text-fg-3">
            ▾
          </span>
        </button>
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
 *  ungated. Clicking "+" opens an anchored popover with an ssh-target input.
 *  Enter commits via `client.hosts.add`; the canvas jumps to the new host once
 *  it joins membership. */
const AddHostAffordance: Component = () => {
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
    focusOnMount(inputEl);
  });
  // The add MECHANISM (parse · hosts.add · activate-on-join · error toast) is
  // the shared `addHost`; this popover supplies only its own cleanup on success.
  const submit = (): void => {
    runAction(
      "add host",
      addHost(draft(), () => {
        setDraft("");
        setOpen(false);
      }),
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
            <p class="mb-2.5 text-[11px] leading-4 text-fg-2">
              Add another machine —{" "}
              <DocLink slug="remote-hosts" data-testid="host-add-docs">
                Learn more →
              </DocLink>
            </p>
            <input
              ref={inputEl}
              type="text"
              data-testid="host-add-input"
              class="pointer-events-auto h-8 w-full rounded-lg border border-edge bg-surface-1 px-2.5 text-xs text-fg placeholder:text-fg-3 transition-colors focus:border-accent/50 focus:bg-surface-2 focus:outline-none"
              placeholder="ssh host, e.g. srid@zest"
              aria-label="ssh host"
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

const HostSelectorStrip: Component = () => {
  // Multi-host chrome is NO LONGER gated on `KOLU_PADI_HOST`: every pool member
  // gets a chip and the "+ add a host" affordance is always present. With no
  // seed the pool is just the local host, so this renders exactly the local
  // chip + "+". `useHostMembers` owns the `padiMap.entries` subscription +
  // `onError` (shared with the mobile row).
  const renderableHosts = useHostMembers();

  // One open diagnostics host — strip-owned (dies with the strip; cleared when
  // the keyed host leaves membership so a re-add never reopens stale).
  const [diagKey, setDiagKey] = createSignal<string | null>(null);
  const diagnostics: DiagnosticsCtl = {
    isOpen: (encKey) => diagKey() === encKey,
    open: (encKey) => setDiagKey(encKey),
    close: () => setDiagKey(null),
    toggle: (encKey) => setDiagKey((cur) => (cur === encKey ? null : encKey)),
  };
  createEffect(() => {
    const open = diagKey();
    if (open === null) return;
    const stillMember = renderableHosts().some(
      (h) => encodeHostKey(h) === open,
    );
    if (!stillMember) setDiagKey(null);
  });

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
          class="host-tablist flex items-end gap-0.5 min-w-0 flex-nowrap"
          data-testid="host-chip-row"
        >
          <For each={hostFit().visible}>
            {(key) => (
              <HostChip host={decodeHostKey(key)} diagnostics={diagnostics} />
            )}
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
                <HostChip host={host} measure diagnostics={diagnostics} />
              </div>
            );
          }}
        </For>
      </div>

      {/* Add a host at runtime — always present now (no `KOLU_PADI_HOST` gate).
       *  Host switching stays on ⌘⇧H / the command palette. */}
      <AddHostAffordance />
    </div>
  );
};

export default HostSelectorStrip;
