/** HostSelectorStrip — the multi-host selector, the visible face of the keyed padi
 *  host map (W4 "the switch").
 *
 *  ALWAYS renders at least one chip — the active host's — regardless of the
 *  server-authored `hostMapGate` cell. What the gate controls is MULTIPLE-host
 *  chrome: every chip beyond the active one, the trailing "+ add a host"
 *  affordance, and the overflow/dropdown machinery below, render only once
 *  `KOLU_PADI_HOST` seeded more than the local default (`isMultiHost()` at
 *  boot) — see {@link shouldRenderHostChip}. The client never reads env; the
 *  cell is the sole cue, and `undefined` (before the first cell frame) reads
 *  closed, so multi-host chrome never flashes in during warm-up.
 *
 *  Host-first: each host tab carries a FIXED-width dual-daemon slot
 *  (`HostDualDaemonSlot`) filled with THAT host's Padi + Kaval marks (active
 *  and inactive alike — so a red remote is obvious without switching first).
 *  Tab selection/accent marks the active host — size never does — so a host
 *  switch reflows nothing. Measure-row twins leave the slot empty so width is
 *  reserved without a second live mount.
 *
 *  Each chip reads, at a glance:
 *    · the host label (LOCAL_HOST shows as "local"), ellipsized to a
 *      narrower max-width below the `lg` breakpoint (a window-resize-driven
 *      stage, never host-switch-driven);
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
 *  A trailing "+ add" opens an inline input → `client.hosts.add`. */

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
import { match } from "ts-pattern";
import { surface } from "../ui/Surface";
import { type AnchorSide, useAnchoredPopover } from "../ui/useAnchoredPopover";
import {
  dotClass,
  hostGateOpen,
  sameHost,
  shouldRenderHostChip,
  statusTitle,
} from "./hostChipTone";
import { HostDualDaemonSlot } from "./HostDaemonChips";
import { computeVisibleHosts, type HostFit } from "./hostOverflow";
import {
  activeHost,
  app,
  client,
  onHostMembershipError,
  padiMap,
  setActiveHost,
} from "../wire";

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
/** The "+ add a host" affordance's own rendered width (`w-7`) + gap —
 *  reserved from the fit budget whenever it renders (gate open). */
const ADD_BUTTON_RESERVE: number = 34;

// Explicit type annotations on these two helpers (rather than inferring off
// the arrow function) are load-bearing, not decorative: this file's
// per-chip `.cells.urgency.use(...)` call (inside `HostChip`, properly
// owned by that component's own reactive instance — no `createRoot` needed)
// sits textually close to whichever top-level `const` happens to precede
// `HostChip`. `standingSubscriptionOwnership.test.ts`'s heuristic flags any
// UNTYPED top-level `const NAME = ` (its signal for "possibly a bare
// standing subscription") and scans a fixed window past it — an untyped
// `const label = (h) => ...` right before `HostChip` would fold that
// unrelated per-chip `.use()` into its window. Typing the identifier
// (`const NAME: T = ...`) makes it visibly a plain value/helper, not a
// candidate the heuristic needs to inspect.
const label: (h: HostKey) => string = (h) =>
  h.kind === "local" ? "local" : h.target;
/** Decode-then-label in one step — used wherever a component only has the
 *  CANONICAL encoded string (an overflowed/menu
 *  key), never a `HostKey` object. */
const labelForKey: (key: string) => string = (key) => label(decodeHostKey(key));

const statusLabel: (host: HostKey) => string = (host) => {
  return match(padiMap.entry(host).state())
    .with({ kind: "connected" }, (state) => statusTitle(state))
    .with({ kind: "warming" }, () => "connecting")
    .with({ kind: "failed" }, () => "failed")
    .with({ kind: "not-a-member" }, () => "removed")
    .exhaustive();
};

const removeHost: (host: HostKey) => void = (host) => {
  client.hosts
    .remove({ host })
    .catch((err: Error) =>
      toast.error(`Couldn't remove ${label(host)}: ${err.message}`),
    );
};

const HostChip: Component<{ host: HostKey; measure?: boolean }> = (props) => {
  // The PURE lens per chip (the host is fixed for this chip's lifetime — the `<For>`
  // gives each chip its own reactive owner, disposed when the host leaves the pool).
  const state = () => padiMap.entry(props.host).state();
  const isLocal = () => props.host.kind === "local";
  const urgency = padiMap.entry(props.host).cells.urgency.use({
    onError: (err: Error) =>
      toast.error(`Host ${label(props.host)} urgency error: ${err.message}`),
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
        // Every tab carries the SAME 1px border box (folder-tab outline) so
        // active and inactive share one geometry — content centers line up to
        // the pixel, no 1px hop on selection.
        class="relative flex h-8 items-center rounded-t-md border transition-colors has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-accent/50 has-[:focus-visible]:ring-inset"
        classList={{
          // Selected tab: a soft `accent` outline + faint accent-tinted fill
          // (kolu's active-state language, `bg-accent/N`) so selection reads
          // in BOTH modes — a neutral `surface-0` fill is invisible against
          // the surface-0-based (theme-tinted) header, which made the dark
          // tab bar unreadable. Bottom border transparent so — pulled by the
          // wrapper's `-mb-px` — it merges through the baseline as the OPEN
          // tab. Soft, not a loud rail; the click focus-ring is gated to
          // keyboard (`has-[:focus-visible]`), never mouse.
          "border-accent/55 border-b-transparent bg-accent/12 text-fg shadow-sm":
            isActive(),
          // Inactive tabs are CLOSED folder tabs — a visible neutral outline +
          // a recessed fill that lightens the dark header enough to read as a
          // tab at rest, brightening on hover. Never invisible text.
          "border-edge/70 bg-surface-2/40 text-fg-2 hover:border-edge hover:bg-surface-2 hover:text-fg":
            !isActive(),
        }}
      >
        <button
          type="button"
          role="tab"
          aria-selected={isActive()}
          class="pointer-events-auto flex h-8 items-center gap-1.5 rounded-tl-md pl-2 pr-2 cursor-pointer transition-colors focus-visible:outline-none"
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
          title={`${label(props.host)} — ${statusTitle(state())}`}
        >
          <span
            class={`inline-block h-2 w-2 rounded-full shrink-0 ${dotClass(state())}`}
            aria-hidden="true"
          />
          {/* Ellipsizes to a NARROWER max-width below `lg` (narrow-window stage
           *  2) — a pure CSS breakpoint, so it only ever moves on a window
           *  resize, never a host switch. */}
          <span class="truncate max-w-[5rem] lg:max-w-[10rem] font-medium">
            {label(props.host)}
          </span>
          {/* Urgency badge — the host's awaiting count, hidden at zero. */}
          <Show when={awaiting() > 0}>
            <span
              class="shrink-0 min-w-4 px-1 h-4 inline-flex items-center justify-center rounded-full bg-amber-500/90 text-[10px] font-semibold text-black/80 tabular-nums"
              title={`${awaiting()} awaiting your input`}
            >
              {awaiting()}
            </span>
          </Show>
        </button>
        <div
          class="flex h-8 items-center transition-colors"
          classList={{ "rounded-tr-md": isLocal() }}
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
            class="pointer-events-auto shrink-0 h-8 w-6 inline-flex items-center justify-center rounded-tr-md text-fg-3 hover:text-danger hover:bg-danger/10 opacity-45 max-lg:opacity-0 group-hover:opacity-100 focus-visible:opacity-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/50 transition-[opacity,color,background-color]"
            data-testid="host-remove"
            aria-label={`Remove host ${label(props.host)}`}
            title={`Remove ${label(props.host)}`}
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
      toast.error(`Host ${label(host)} urgency error: ${err.message}`),
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
        title={`${label(host)} — ${statusTitle(state())}`}
        class="pointer-events-auto flex min-w-0 items-center gap-2 rounded-md px-1.5 py-1 text-left transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/50"
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
            <span class="truncate">{label(host)}</span>
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
        class="rounded-lg shadow-[inset_0_0_0_1px_var(--color-edge)]"
        classList={{
          "bg-surface-0/70": isActive(),
          "bg-surface-0/45": !isActive(),
        }}
        aria-label={`Switch to ${label(host)}`}
        title={`Switch to ${label(host)}`}
        onClick={pickHost}
      >
        <HostDualDaemonSlot host={host} mode="static" />
      </button>
      <Show when={!isLocal()} fallback={<span class="h-7 w-6" />}>
        <button
          type="button"
          class="pointer-events-auto h-7 w-6 inline-flex items-center justify-center rounded-lg text-fg-3 opacity-60 transition-[opacity,color,background-color] hover:bg-danger/10 hover:text-danger group-hover/host-row:opacity-100 focus-visible:opacity-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/50"
          data-testid={`${props.testIdPrefix}-remove-${props.hostKey}`}
          aria-label={`Remove host ${label(host)}`}
          title={`Remove ${label(host)}`}
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
        class="pointer-events-auto shrink-0 h-8 px-2 inline-flex items-center gap-1 rounded-md bg-transparent text-xs text-fg-3 transition-colors hover:bg-surface-1/60 hover:text-fg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/50"
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
          class="pointer-events-auto flex h-8 items-center gap-1.5 rounded-tl-md pl-2 pr-2 text-xs text-fg transition-colors focus-visible:outline-none"
          aria-label={`Switch host — currently ${label(active())}`}
          title={`Switch host — currently ${label(active())}`}
          onClick={() => setOpen((v) => !v)}
        >
          <span
            class={`inline-block h-2 w-2 rounded-full shrink-0 ${dotClass(padiMap.entry(active()).state())}`}
            aria-hidden="true"
          />
          <span class="truncate max-w-[5rem] font-medium">
            {label(active())}
          </span>
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

const HostSelectorStrip: Component = () => {
  const gate = app.cells.hostMapGate.use({
    onError: (err: Error) =>
      toast.error(`Host gate subscription error: ${err.message}`),
  });
  const [adding, setAdding] = createSignal(false);
  const [draft, setDraft] = createSignal("");
  const members = padiMap.entries.use({ onError: onHostMembershipError });
  let addInputRef: HTMLInputElement | undefined;

  createEffect(() => {
    if (!adding()) return;
    queueMicrotask(() => {
      if (addInputRef?.isConnected) addInputRef.focus({ preventScroll: true });
    });
  });

  // The gate DECISION (see hostChipTone.ts) — MULTIPLE-host chrome (extra
  // chips, "+ add", the overflow/dropdown machinery) only once open.
  const gateOpen = () => hostGateOpen(gate.value());

  // The pool, filtered through the SAME per-chip predicate the gate has
  // always used — closed ⇒ only the active host qualifies (so a transient
  // gate-closed-with-a-stray-guest membership frame can never render one),
  // open ⇒ every pool member does.
  const renderableHosts = (): HostKey[] =>
    [...members.keys()].filter((h) =>
      shouldRenderHostChip(gateOpen(), sameHost(activeHost(), h)),
    );

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
  const chipsBudget = createMemo(
    () => containerWidth() - (gateOpen() ? ADD_BUTTON_RESERVE : 0),
  );
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

  const submitAdd = (): void => {
    const raw = draft().trim();
    if (raw === "") return;
    // `parseHostInput` is TOTAL (a nominal sum has no reserved-name reject left to fail —
    // typing "local" just parses to the Local variant, which is always ALREADY a pool
    // member). So there is no client-side pre-validation to fail loud on: `hosts.add`'s own
    // "host already exists" rejection is the honest, single error surface — for a literal
    // "local" retype exactly as it would be for re-adding any other existing member.
    const host = parseHostInput(raw);
    client.hosts
      .add({ host })
      .then(() => {
        setDraft("");
        setAdding(false);
      })
      .catch((err: Error) =>
        toast.error(`Couldn't add ${raw}: ${err.message}`),
      );
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
      class="pointer-events-auto relative flex h-8 flex-1 items-end gap-1.5 min-w-0 border-b border-edge/80"
      data-testid="host-selector-strip"
    >
      <Show
        when={gateOpen()}
        fallback={
          <div
            role="tablist"
            aria-label="Hosts"
            class="flex items-end gap-1 min-w-0 flex-nowrap"
          >
            <For each={renderableHosts()}>
              {(host) => <HostChip host={host} />}
            </For>
          </div>
        }
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
            class="flex items-end gap-1 min-w-0 flex-nowrap"
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
      </Show>

      {/* Hidden measuring row — off-screen (position absolute, so it never
       *  affects this container's own layout), invisible + inert, mounts
       *  every renderable host's chip a second time purely so its natural
       *  width can be read via the `ResizeObserver` above. NOTE for a future
       *  e2e author: this means `[data-testid="host-chip"]` can match TWICE
       *  per host while the gate is open — the real (visible) one and this
       *  hidden twin. `aria-hidden` + `pointer-events-none` keep it out of
       *  the accessibility tree and unclickable, and Playwright's
       *  visibility-aware actions (`.click()`) skip it, but a bare
       *  `.count()`/`.all()` would not — scope any such query under
       *  `[data-testid="host-chip-row"]` (or the dropdown switcher) to reach
       *  only the real one. */}
      <Show when={gateOpen()}>
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
      </Show>

      {/* Add a host at runtime — an inline input toggled from a "+" affordance.
       *  Multiple-host chrome, so it shares the extra chips' gate. */}
      <Show when={gateOpen()}>
        <Show
          when={adding()}
          fallback={
            <button
              type="button"
              class="pointer-events-auto shrink-0 h-8 w-8 inline-flex items-center justify-center rounded-md text-fg-3 transition-colors hover:bg-surface-1/60 hover:text-fg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/50"
              data-testid="host-add-open"
              aria-label="Add a host"
              title="Add a host (ssh target)"
              onClick={() => setAdding(true)}
            >
              +
            </button>
          }
        >
          <input
            ref={addInputRef}
            type="text"
            class="pointer-events-auto shrink-0 h-7 w-40 px-2 rounded-lg border border-accent/60 bg-surface-2 text-xs text-fg placeholder:text-fg-3 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/50"
            data-testid="host-add-input"
            placeholder="ssh host, e.g. srid@zest"
            value={draft()}
            onInput={(e) => setDraft(e.currentTarget.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") submitAdd();
              if (e.key === "Escape") {
                setDraft("");
                setAdding(false);
              }
            }}
            onBlur={() => {
              // Close on blur without adding — Enter is the only commit path.
              if (draft().trim() === "") setAdding(false);
            }}
          />
        </Show>
      </Show>
    </div>
  );
};

export default HostSelectorStrip;
