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
 *    · remove is in the popover with a confirm step;
 *    · DRAG a remote tab to re-order the strip. The arrangement is a server
 *      preference (`hostOrder`), so every browser and device shows it; the
 *      ordering fold itself is `hostOrder.ts`, applied once at the membership
 *      source (wire's `hostKeys` — the ONE ordered list every host LIST reads).
 *      The local tab is pinned first and takes no part in the gesture.
 *  A click on the label switches the canvas (a synchronous signal write —
 *  `useEntry(activeHost)` re-keys, no reload). A finished DRAG's trailing click
 *  is swallowed (`dragClickGuard`), so re-ordering a tab never also activates
 *  it and grabbing the status dot never opens diagnostics.
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
 *      the active chip + as many others as fit, in the arranged order, and folds
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

import { useActiveHostSelector } from "./isActiveHost";

import {
  closestCenter,
  createSortable,
  DragDropProvider,
  DragDropSensors,
  type DragEvent,
  SortableProvider,
} from "@thisbeyond/solid-dnd";
import { createMediaQuery } from "@solid-primitives/media";
import { createResizeObserver } from "@solid-primitives/resize-observer";
import {
  decodeHostKey,
  encodeHostKey,
  type HostKey,
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
import {
  activeHost,
  hostKeys,
  padiMap,
  setActiveHost,
  updatePreferences,
} from "../wire";
import { addHost } from "./addHost";
import { focusOnMount } from "./focusOnMount";
import {
  releaseHostDiagnosticsAnchor,
  toggleHostDiagnostics,
  useHostDiagnosticsSelector,
} from "./useHostDiagnosticsOpen";
import { HostChipShell } from "./HostChipShell";
import { HostIdentityLabel } from "./HostIdentityLabel";
import AgentDistroHostMark from "../agents/AgentDistroHostMark";
import { forwardRingLabel, HostStatusDot } from "./HostStatusDot";
import { HostTabWorkingStripe, hostActiveLabel } from "./HostTabWorkingStripe";
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
import { CONTEXTUAL_TIPS } from "../settings/tips";
import { useTips } from "../settings/useTips";
import { runAction } from "../runAction";
import { computeVisibleHosts, type HostFit } from "./hostOverflow";
import { removeHost } from "./removeHost";
import { createDragClickGuard } from "./dragClickGuard";
import { isPinnedHostKey, moveHostKey, reorderableHostKeys } from "./hostOrder";

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

const HostChip: Component<{
  host: HostKey;
  /** solid-dnd's `createSortable` as a DIRECTIVE, filled by
   *  {@link SortableHostChip} for a RE-ORDERABLE (i.e. non-pinned) chip and left
   *  empty for the pinned one — which is therefore neither draggable nor a drop
   *  target. The directive registers the node, the activators AND the per-frame
   *  transform in solid-dnd's own effects, writing `element.style.transform`
   *  directly, which is what lets this chip root carry no spread and no `style`
   *  binding: Solid groups every dynamic attribute on one element into ONE
   *  effect, so a per-frame `style` here would re-read `isActive()` / `down()` →
   *  `glance()` → `hostGlance(state(), kaval())` on every pointer move (and a
   *  spread would re-add the activator listeners each frame, `dragActivators`
   *  minting a fresh record per read). */
  drag?: (el: HTMLElement) => void;
  /** Consume the click a finished drag leaves behind — see `dragClickGuard`. */
  swallowClick?: () => boolean;
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
  // The activity fact rides the tab's bottom edge as a running stripe and the
  // buttons' labels as words — never a segment beside the name, whose coming
  // and going changed the tab's width and shifted the whole strip.
  const activeSuffix = () =>
    marks.active() > 0 ? `, ${hostActiveLabel(marks.active())}` : "";
  // The active-host signal + this chip's own host are compared by their CANONICAL
  // string (`sameHost`) — a `HostKey` is an object with no reference identity across
  // independent decodes, so `===` would silently never match a logically-equal remote.
  const selectedHost = useActiveHostSelector();
  const isActive = () => selectedHost(encodeHostKey(props.host));
  // #2101 N4: the presented state composes the daemon chain — a padi-up host
  // whose kaval is down must not paint the connected green.
  const kaval = useHostKavalChain(props.host);
  const glance = () => hostGlance(state(), kaval());
  const down = () => glance().down;
  // Always-on connection status — also the diagnostics open control.
  const statusDot = () => chipStatusDot(props.host, state(), kaval());
  const { hostname } = useServerIdentity();
  const name = () => hostDisplayName(props.host, hostname());
  // Shared open key — only ONE diagnostics panel is open at a time, and the
  // agents mark and Settings' Agents line open it too.
  const isOpen = useHostDiagnosticsSelector();
  const diagOpen = () => isOpen(encKey);

  let chipEl: HTMLDivElement | undefined;

  // UNIFORM SHAPE: measurable SIZE never depends on `isActive()` — only
  // border/bg/text COLOR, and the drag transform is a translate, so a chip keeps
  // its width while it is being carried. Identity switches; status pip opens
  // diagnostics.
  return (
    <div
      ref={(el) => {
        chipEl = el;
        // The sortable's node, activators and transform in one call, when this
        // chip is re-orderable (see the `drag` prop's doc).
        props.drag?.(el);
        // This chip owns the element it hands the panel: when it unmounts
        // (overflow fit, the `md` row going away) the panel must not stay
        // floating against a detached node.
        onCleanup(() => releaseHostDiagnosticsAnchor(el));
      }}
      class="group -mb-px flex items-center shrink-0 text-xs"
      // A finished drag's trailing `click` lands on whichever of the chip's two
      // buttons the gesture started on — switching host, or toggling
      // diagnostics. Swallow it in the CAPTURE phase, before either button's
      // (delegated) handler runs. The pinned chip passes no guard, so nothing
      // is ever swallowed there.
      on:click={{
        capture: true,
        handleEvent: (e) => {
          if (props.swallowClick?.() !== true) return;
          e.stopPropagation();
          e.preventDefault();
        },
      }}
      data-testid="host-chip"
      data-host={encKey}
      data-active={isActive() ? "" : undefined}
      data-down={down() ? "" : undefined}
    >
      <HostChipShell
        host={props.host}
        decoration={glance().labelDecoration}
        active={isActive()}
        down={down()}
        tab={{
          style: { "--host-hue": hostHue(props.host) },
          "data-asking": marks.asking() > 0 && !isActive() ? "" : undefined,
          "data-unseen":
            marks.unseenFinished() > 0 && marks.asking() === 0 && !isActive()
              ? ""
              : undefined,
        }}
        diagnostics={{
          "data-testid": "host-diagnostics-open",
          "aria-haspopup": "dialog",
          "aria-expanded": diagOpen(),
          "aria-label": `Details for ${name()} — ${glance().title}${activeSuffix()}${forwardCount() > 0 ? `, ${forwardRingLabel(forwardCount())}` : ""}`,
          title: `${glance().title}${activeSuffix()} — click for details`,
          onClick: (e) => {
            e.stopPropagation();
            // The pip is INSIDE the chip, so the ref is set by the time it
            // can be clicked — fail loudly if that ever stops holding rather
            // than eating the click.
            if (chipEl === undefined)
              throw new Error("host chip has no element to hang details off");
            toggleHostDiagnostics(encKey, chipEl);
          },
        }}
        select={{
          role: "tab",
          "aria-selected": isActive(),
          "data-testid": "host-select",
          onClick: () => {
            if (!isActive()) setActiveHost(props.host);
          },
          title: `${name()} — ${glance().title}${activeSuffix()}`,
        }}
        status={
          <HostStatusDot
            statusDot={statusDot()}
            forwardCount={forwardCount()}
          />
        }
        attention={
          // No `active`: the tab carries that fact as its running stripe, so
          // its width is the same whether zero or ten terminals are working.
          <AttentionTriplet
            asking={marks.asking()}
            unseen={marks.unseenFinished()}
            viewing={isActive()}
            sizeClass="min-w-4 px-1 h-4"
            scopeLabel={name()}
            onAsking={() => jumpToAsking(encKey)}
            class="-ml-1 mr-2.5"
          />
        }
        agents={<AgentDistroHostMark host={props.host} />}
        stripe={<HostTabWorkingStripe active={marks.active()} />}
      />
      {/* The panel itself mounts once at the shell
          (`host/HostDiagnosticsHost`): Settings opens it too, at widths
          where this chip row is not mounted at all. */}
    </div>
  );
};

/** A RE-ORDERABLE chip — the whole tab is one sortable (`createSortable` needs
 *  its own reactive owner, hence a component rather than a call inside the
 *  `<For>` body). Only non-pinned hosts get one: the local host is the pool's
 *  unremovable default and the always-available escape hatch, so it is pinned
 *  first, is not draggable, and — not being a droppable — nothing can land
 *  before it. */
const SortableHostChip: Component<{ hostKey: string }> = (props) => {
  const sortable = createSortable(props.hostKey);
  // `props.hostKey` is this chip's identity for its whole lifetime (the row's
  // `<For>` is keyed by the encoded string), so the host decodes exactly once —
  // the referential stability `HostChip`'s per-host lenses rest on.
  const host = decodeHostKey(props.hostKey);
  const swallowClick = createDragClickGuard(() => sortable.isActiveDraggable);
  return <HostChip host={host} drag={sortable} swallowClick={swallowClick} />;
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
  const selectedHost = useActiveHostSelector();
  const isActive = () => selectedHost(props.hostKey);
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
  // chip + "+". `hostKeys` (wire.ts) is the ONE ordered host list — the
  // app-lifetime `padiMap.entries` membership folded through the `hostOrder`
  // preference, memoised there, so every surface that lists hosts agrees.
  const { showTipOnce } = useTips();

  // WHICH host's details are open is a module singleton
  // (`useHostDiagnosticsOpen`), and the panel mounts once at the shell
  // (`HostDiagnosticsHost`), which also closes a key whose host left the
  // pool — this strip is not mounted at every width, so neither the panel
  // nor that invariant can live here.

  // ── Overflow fit (narrow-window stage 3) ──────────────────────────────
  // Real DOM measurement: a HIDDEN row (absolutely positioned, `invisible`,
  // `pointer-events-none`, so it never paints or intercepts a click) mounts
  // the data-free `HostChipShell` for each host purely to read its
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
    hostKeys().map((h) => {
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

  // ── Drag to re-order (desktop strip only) ─────────────────────────────
  // The sortable ids: the SEATED chips minus the pinned one, in rendered order —
  // `SortableProvider` reads index positions off this list.
  const draggableVisible = createMemo(() =>
    hostFit().visible.filter((key) => !isPinnedHostKey(key)),
  );
  // The first strip holding two SEATED remote tabs — the first moment a drag
  // changes anything (one remote beside the pinned local tab has nowhere to
  // go). The tip announces the gesture there, then never again.
  createEffect(() => {
    if (draggableVisible().length > 1)
      showTipOnce(CONTEXTUAL_TIPS.hostRearrange);
  });
  /** A drop writes the WHOLE next arrangement — every re-orderable member,
   *  seated or overflowed — so the stored order stays a total list and the next
   *  merge rule stays one. `updatePreferences` owns the failure report (a toast
   *  carrying the server's own message); there is no local fallback order to
   *  fall back to, and a write that failed must not look like it landed.
   *
   *  The drop target is a HOST, not a seat. When the active host was pulled out
   *  of the overflow it sits LAST on the strip while keeping its own slot in the
   *  arrangement (`computeVisibleHosts` borrows it a seat, never a position), so
   *  dropping onto it moves the dragged host to that real slot — which may be
   *  inside the overflow. Deliberate: the arrangement is the thing being edited,
   *  and a borrowed seat is a width accident, not an order the user set. */
  const dropHost = ({ draggable, droppable }: DragEvent): void => {
    if (!droppable || draggable.id === droppable.id) return;
    updatePreferences({
      hostOrder: moveHostKey(
        reorderableHostKeys(hostKeys()),
        String(draggable.id),
        String(droppable.id),
      ),
    });
  };

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
      <div classList={{ hidden: atMd() }} inert={atMd()}>
        <HostDropdownSwitcher hosts={hostKeys()} />
      </div>
      <div classList={{ hidden: !atMd() }} inert={!atMd()}>
        {/* The strip's OWN drag context, so a chip drag can never surface to
         *  the canvas's provider — sortables bind to the NEAREST
         *  `DragDropProvider`, and the nest is the isolation (the dock makes
         *  the same nest for the same reason). Desktop only: the narrow
         *  dropdown switcher and the phone host row are lists, not a strip,
         *  and have no re-order gesture. */}
        <DragDropProvider
          collisionDetector={closestCenter}
          onDragEnd={dropHost}
        >
          <DragDropSensors />
          {/* Only the chips the fit computation SEATED are sortables, so only
           *  they are drop targets; a host folded into "⋯ +N" keeps its
           *  relative slot through a drag it took no part in (`moveHostKey`
           *  splices over the WHOLE re-orderable list). The local chip is
           *  absent from these ids on purpose — see `SortableHostChip`. */}
          <SortableProvider ids={draggableVisible()}>
            <div
              role="tablist"
              aria-label="Hosts"
              class="host-tablist flex items-end gap-0.5 min-w-0 flex-nowrap"
              data-testid="host-chip-row"
            >
              {/* A row's key never changes for that row (the `<For>` is keyed by
               *  it), so "is this the pinned tab?" is decided ONCE at mount —
               *  a plain conditional, not a reactive `<Show>` boundary. */}
              <For each={hostFit().visible}>
                {(key) =>
                  isPinnedHostKey(key) ? (
                    <HostChip host={decodeHostKey(key)} />
                  ) : (
                    <SortableHostChip hostKey={key} />
                  )
                }
              </For>
              <Show when={hostFit().overflowed.length > 0}>
                <HostOverflowMenu hosts={hostFit().overflowed} />
              </Show>
            </div>
          </SortableProvider>
        </DragDropProvider>
      </div>

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
        <For each={hostKeys()}>
          {(host) => {
            const key = encodeHostKey(host);
            onCleanup(() => setMeasureRefs(key, undefined));
            return (
              <div
                ref={(el) => setMeasureRefs(key, el)}
                data-host-key={key}
                class="shrink-0"
              >
                <div class="group -mb-px flex items-center shrink-0 text-xs">
                  <HostChipShell
                    host={host}
                    attention={
                      // In step with the live tab: no `active` segment
                      // there, so none here — the running stripe costs no
                      // width, and the estimate must not count one.
                      <AttentionTriplet
                        asking={hostMarks(key).asking()}
                        unseen={hostMarks(key).unseenFinished()}
                        viewing={useActiveHostSelector()(key)}
                        sizeClass="min-w-4 px-1 h-4"
                        scopeLabel="Measurement"
                        class="-ml-1 mr-2.5"
                      />
                    }
                    agents={<AgentDistroHostMark host={host} measuring />}
                  />
                </div>
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
