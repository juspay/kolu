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
 *  PROPOSAL A / host-first: each host chip carries a FIXED-width dual-daemon
 *  slot (`HostDualDaemonSlot`). Only the ACTIVE chip fills it with Padi +
 *  Kaval; inactive chips leave the same outer box empty. Ring/accent still
 *  mark the active chip — size never does — so a host switch reflows nothing.
 *  (Iteration 1 filled without reserving empty siblings and reflowed;
 *  iteration 2 parked daemons in a stationary ChromeBar slot; this is the
 *  reserved-width return to the chip.)
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
 *    · the dual-daemon slot (active: Padi + Kaval marks; inactive: empty reserve);
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
 *      the rest into a trailing "⋯ +N" `OptionMenu` (`HostOverflowMenu`) —
 *      click an entry to switch. Strictly one row, fixed height: no wrap, no
 *      clip, no scroll (the old `overflow-x-auto` scroll fallback is
 *      retired).
 *   4. `sm..md` — this component's actual narrowest LIVE range: the whole
 *      row collapses to `HostDropdownSwitcher` — one chip showing the
 *      active host (still carrying the dual-daemon fill), opening an
 *      `OptionMenu` of every host to switch.
 *
 *  A trailing "+ add" opens an inline input → `client.hosts.add`. */

import { createResizeObserver } from "@solid-primitives/resize-observer";
import {
  decodeHostKey,
  encodeHostKey,
  type HostKey,
  parseHostInput,
} from "kolu-common/hostKey";
import {
  type Component,
  createMemo,
  createSignal,
  For,
  onCleanup,
  Show,
} from "solid-js";
import { createStore } from "solid-js/store";
import { toast } from "solid-sonner";
import { OptionMenu, type OptionMenuItem } from "../ui/OptionMenu";
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
const FIRST_FRAME_CHIP_WIDTH_GUESS: number = 148;
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
 *  CANONICAL encoded string (an `OptionMenu`'s `value`, an overflowed/menu
 *  key), never a `HostKey` object. */
const labelForKey: (key: string) => string = (key) => label(decodeHostKey(key));

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
  // A non-interactive CONTAINER holding real buttons — SELECT, optional dual-
  // daemon marks (active only), and guest REMOVE. Nested buttons stay siblings
  // so a11y stays valid (no button-in-button).
  //
  // UNIFORM SHAPE: this chip's measurable SIZE never depends on `isActive()` —
  // only border/bg/text COLOR (ring/accent) and the dual-slot's *content* do.
  // The dual-daemon outer box is fixed-width on every chip (filled or empty),
  // which is what makes `hostOverflow.ts`'s "a host switch never changes
  // width/position" invariant true BY CONSTRUCTION.
  return (
    <div
      class="group flex items-stretch rounded-lg border text-xs overflow-hidden shrink-0 transition-colors"
      classList={{
        "border-accent/60 ring-1 ring-accent/30": isActive(),
        "border-edge": !isActive(),
      }}
      data-testid="host-chip"
      data-host={encodeHostKey(props.host)}
      data-active={isActive() ? "" : undefined}
    >
      <button
        type="button"
        class="pointer-events-auto flex items-center gap-1.5 h-7 pl-2 pr-1.5 cursor-pointer transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/50"
        classList={{
          "bg-surface-3 text-fg": isActive(),
          "bg-surface-2/70 text-fg-2 hover:bg-surface-2 hover:text-fg":
            !isActive(),
        }}
        data-testid="host-select"
        aria-pressed={isActive()}
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
      {/* Fixed-width dual-daemon slot — fill derived from host vs activeHost. */}
      <div
        classList={{
          "bg-surface-3": isActive(),
          "bg-surface-2/70": !isActive(),
        }}
      >
        <HostDualDaemonSlot host={props.host} measure={props.measure} />
      </div>
      {/* Remove — guest hosts only. The local default is unremovable (the server
       *  rejects it LOUD; we also hide the affordance so it never invites the error).
       *  Visible DIMMED at rest above `lg` (opacity-60 on the muted text-fg-3 tone,
       *  never opacity-0 there — a fully-invisible-until-hover ✕ reads as a blank
       *  gap, the bug srid's screenshot flagged); below `lg` (narrow-window stage 2)
       *  it hides at rest — `max-lg:opacity-0` — but stays reachable via
       *  hover/focus (`group-hover:opacity-100`/`focus-visible:opacity-100`, both
       *  UNPREFIXED so they win at every width). Landed standalone ahead of this
       *  redesign — see c0e5d4cf4 — kept identical in spirit here, just narrower
       *  at rest below `lg`. */}
      <Show when={!isLocal()}>
        <button
          type="button"
          class="pointer-events-auto shrink-0 px-1.5 inline-flex items-center justify-center text-fg-3 hover:text-red-400 hover:bg-surface-3 opacity-60 max-lg:opacity-0 group-hover:opacity-100 focus-visible:opacity-100 focus-visible:outline-none transition-opacity"
          data-testid="host-remove"
          aria-label={`Remove host ${label(props.host)}`}
          title={`Remove ${label(props.host)}`}
          onClick={() => {
            client.hosts
              .remove({ host: props.host })
              .catch((err: Error) =>
                toast.error(
                  `Couldn't remove ${label(props.host)}: ${err.message}`,
                ),
              );
          }}
        >
          ✕
        </button>
      </Show>
    </div>
  );
};

/** The trailing "⋯ +N" trigger for chips the fit computation couldn't seat —
 *  an `OptionMenu` list of the overflowed hosts; picking one switches. No
 *  entry is ever pre-selected (an overflowed host is, by definition, never
 *  the active one), so `value` is a sentinel that matches no option.
 *
 *  Takes CANONICAL encoded keys (not `HostKey` objects) — `props.hosts` is
 *  `hostFit().overflowed` straight from `computeVisibleHosts`, and staying with
 *  its string identity all the way to `OptionMenu`'s own `<For>` matters:
 *  `<For>` keys by `===`, and every `HostKey` decode mints a fresh object,
 *  so decoding a level higher would make the menu's own option list
 *  needlessly re-key whenever anything upstream re-renders. */
const HostOverflowMenu: Component<{ hosts: string[] }> = (props) => {
  const [open, setOpen] = createSignal(false);
  let triggerEl: HTMLButtonElement | undefined;
  const options = (): OptionMenuItem<string>[] =>
    props.hosts.map((key) => ({ value: key, label: labelForKey(key) }));

  return (
    <>
      <button
        type="button"
        ref={triggerEl}
        data-testid="host-overflow-trigger"
        class="pointer-events-auto shrink-0 h-7 px-2 inline-flex items-center gap-1 rounded-lg border border-edge text-xs text-fg-3 hover:text-fg hover:bg-surface-2 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/50"
        aria-label={`${props.hosts.length} more host${props.hosts.length === 1 ? "" : "s"}`}
        title={`${props.hosts.length} more host${props.hosts.length === 1 ? "" : "s"} — click to switch`}
        onClick={() => setOpen((v) => !v)}
      >
        ⋯ +{props.hosts.length}
      </button>
      <OptionMenu
        triggerRef={() => triggerEl}
        open={open}
        onDismiss={() => setOpen(false)}
        anchor="bottom-start"
        options={options()}
        value=""
        onSelect={(v) => setActiveHost(decodeHostKey(v))}
        testIdPrefix="host-overflow"
        truncate
      />
    </>
  );
};

/** Narrow multi-host range (`sm..md`): one bordered unit — select trigger +
 *  dual-daemon slot for the active host (same composition shape as `HostChip`,
 *  without per-host chips). `OptionMenu` lists every pool host to switch to. */
const HostDropdownSwitcher: Component<{ hosts: HostKey[] }> = (props) => {
  const [open, setOpen] = createSignal(false);
  let triggerEl: HTMLButtonElement | undefined;
  const active = () => activeHost();
  const options = (): OptionMenuItem<string>[] =>
    props.hosts.map((h) => ({ value: encodeHostKey(h), label: label(h) }));

  return (
    <>
      <div
        class="flex items-stretch rounded-lg border border-accent/60 ring-1 ring-accent/30 bg-surface-3 overflow-hidden shrink-0"
        data-testid="host-dropdown-switcher"
      >
        <button
          type="button"
          ref={triggerEl}
          class="pointer-events-auto flex items-center gap-1.5 h-7 pl-2 pr-1.5 text-xs text-fg transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/50"
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
        <HostDualDaemonSlot host={active()} />
      </div>
      <OptionMenu
        triggerRef={() => triggerEl}
        open={open}
        onDismiss={() => setOpen(false)}
        anchor="bottom-start"
        options={options()}
        value={encodeHostKey(active())}
        onSelect={(v) => setActiveHost(decodeHostKey(v))}
        testIdPrefix="host-switcher"
        truncate
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
      class="pointer-events-auto relative flex flex-1 items-center gap-1.5 min-w-0"
      data-testid="host-selector-strip"
    >
      <Show
        when={gateOpen()}
        fallback={
          <For each={renderableHosts()}>
            {(host) => <HostChip host={host} />}
          </For>
        }
      >
        {/* `md` and up: the fit row — active chip + as-many-as-fit, rest in
         *  the "⋯ +N" menu. Strictly one row, fixed height: never wraps.
         *
         *  The split below is keyed on `md` (768px), NOT `sm` (640px):
         *  `ChromeBar` (and this whole component) never mounts at all below
         *  `sm` — `useMobile.ts`'s `layoutMode` swaps to an entirely
         *  different phone chrome (`MobileChromeSheet`) at that width, a
         *  fork this file has no say over. So `sm` is this component's own
         *  WIDEST point of extinction, not a stage within it — pegging stage
         *  4 there would make it unreachable dead code. `640..768px` is
         *  this component's actual narrowest LIVE range (a real desktop
         *  window resized narrow, or a `compact`-mode handheld above `sm`),
         *  so that is where "mobile-extreme" lands. */}
        <div
          class="hidden md:flex items-center gap-1.5 min-w-0 flex-nowrap"
          data-testid="host-chip-row"
        >
          <For each={hostFit().visible}>
            {(key) => <HostChip host={decodeHostKey(key)} />}
          </For>
          <Show when={hostFit().overflowed.length > 0}>
            <HostOverflowMenu hosts={hostFit().overflowed} />
          </Show>
        </div>

        {/* `sm..md` (mobile-extreme, narrow-window stage 4 — this
         *  component's actual narrowest reachable range, see above): one
         *  dropdown unit (select + dual-daemon) replaces the chip row. */}
        <div class="flex md:hidden">
          <HostDropdownSwitcher hosts={renderableHosts()} />
        </div>
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
              class="pointer-events-auto shrink-0 h-7 w-7 inline-flex items-center justify-center rounded-lg border border-dashed border-edge text-fg-3 hover:text-fg hover:border-accent/60 transition-colors"
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
            type="text"
            class="pointer-events-auto shrink-0 h-7 w-40 px-2 rounded-lg border border-accent/60 bg-surface-2 text-xs text-fg placeholder:text-fg-3 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/50"
            data-testid="host-add-input"
            placeholder="ssh host, e.g. srid@zest"
            autofocus
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
