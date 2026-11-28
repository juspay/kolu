import { createWindowSize } from "@solid-primitives/resize-observer";
import Dialog from "@corvu-next/dialog";
import { fleetTerminalRef } from "kolu-mcp/fleetRef";
import {
  type Component,
  createEffect,
  createMemo,
  createSignal,
  For,
  onSettled,
  runWithOwner,
  Show,
  untrack,
} from "solid-js";
import { DEFAULT_FONT_SIZE, getThemeByName } from "terminal-themes";
import type { TerminalGrid } from "@kolu/xterm-kit/solid";
import { fleetTerminalStanding } from "../../palette/fleetTerminals";
import ModalDialog from "../../ui/ModalDialog";
import MobileKeyBar from "../../MobileKeyBar";
import { useShown } from "../../ui/shown";
import { layoutMode, isTouch } from "../../useMobile";
import { useMemberName } from "../memberNames";
import { useOpenTile } from "../useOpenTile";
import { inputAllowedAt, personInputAt } from "../personInput";
import WorkLock from "../WorkLock";
import { ROLE_WORD } from "../workReadings";
import { useMembership, useWorkMembers } from "../useWorks";
import { liveArm, terminalStatus } from "../terminalStatus";
import { createLookable } from "./lookable";
import PeekTerminal, { type PeekTerminalHandle } from "./PeekTerminal";
import { TerminalControls, TerminalStatusLine } from "./TerminalHead";
import {
  type PeekCell,
  type PeekPad,
  fitFontSize,
  peekNatural,
  peekPans,
  peekWindowSize,
} from "./peekSize";
import {
  closePeek,
  keyRaisesLockOffer,
  openPeek,
  peekTabs,
  peekTarget,
  peekTyping,
  peekFootWords,
  usePeekTyping,
  type PeekTarget,
} from "./usePeek";
import { fitWidth, setFitWidth } from "../fitWidth";

const TAB_CLASS =
  "flex h-7 shrink-0 items-center gap-1.5 whitespace-nowrap rounded-t-lg px-2.5 text-[0.72rem]";

const TerminalPeek: Component = () => {
  const shown = useShown();
  createEffect(
    () => shown(),
    (isShown) => {
      if (!isShown) closePeek();
    },
  );
  return (
    <ModalDialog
      open={peekTarget() !== null}
      onOpenChange={(open) => {
        if (!open) closePeek();
      }}
      size="fit"
      escapeCloses={!peekTyping()}
      placesOwnFocus
    >
      <Show when={peekTarget()} keyed>
        {(target) => <PeekWindow target={target} />}
      </Show>
    </ModalDialog>
  );
};

const PeekWindow: Component<{ target: PeekTarget }> = (props) => {
  const name = useMemberName();
  const ref = fleetTerminalRef(props.target.host, props.target.id);
  const members = useWorkMembers();
  const tabs = createMemo(() =>
    peekTabs(
      members(),
      ref,
      (host, id) => liveArm(fleetTerminalStanding(host, id)) !== undefined,
    ),
  );
  const standing = createMemo(() =>
    fleetTerminalStanding(props.target.host, props.target.id),
  );
  const status = createMemo(() => terminalStatus(standing()));
  const lookable = createLookable(standing);
  const openTileAt = useOpenTile();
  const openingGrid = untrack(() => liveArm(standing())?.grid ?? null);
  const [grid, setGrid] = createSignal<TerminalGrid | null>(
    // READ ONCE: the window opens on the size the terminal has now, and
    // every size after this one arrives through `onGrid`.
    openingGrid,
  );
  const [cell, setCell] = createSignal<PeekCell | null>(null);
  /** THE CELL ONE CHARACTER TAKES AT THE BASE FONT — a measurement KEPT past
   *  the dispatch it arrived in, and the only such capture the window holds.
   *  It is keyed to the screen that produced it by the keyed
   *  `<Show when={peekTarget()} keyed>` above: a window moved to another
   *  terminal is another `PeekWindow`, so no cell of the terminal it was
   *  moved off can size this one (`baseCellPeers.test.tsx`). */
  const [baseCell, setBaseCell] = createSignal<PeekCell | null>(null);
  const [pad, setPad] = createSignal<PeekPad | null>(null);
  const [phase, setPhase] = createSignal<"reading" | "live" | "reconnecting">(
    "reading",
  );
  const [held, setHeld] = createSignal(false);
  const [focused, setFocused] = createSignal(false);
  /** The screen's keyboard door, handed up by `PeekTerminal`'s `onReady`.
   *  `ownedWrite`: this is the window's OWN internal signal, and `onReady`
   *  runs under this component's owner (the kit re-enters it with
   *  `runWithOwner` once the font has loaded,
   *  `xterm-kit/solid/xtermLifecycle.ts`) — so the one write it ever takes
   *  is, by construction, a write in an owned scope. */
  const [handle, setHandle] = createSignal<PeekTerminalHandle | undefined>(
    undefined,
    { ownedWrite: true },
  );
  const membership = useMembership();
  const driver = () => membership().get(ref)?.driver ?? "nobody";
  const mayType = () => inputAllowedAt(ref);
  /** The peek's typing lock IS this derivation (`usePeek.ts`): the window
   *  lends it up rather than copying its answer into a signal, so the Esc
   *  gate above never trails the keyboard by a flush. */
  const typing = () => focused() && mayType();
  usePeekTyping(typing);
  createEffect(
    () => ({
      driver: driver(),
      // READ ONCE, not depended on: the keyboard follows the DRIVER
      // changing, not the screen's handle arriving.
      handle: untrack(handle),
    }),
    (now, before) => {
      // SETTLED. The DOM `focus()` is this effect's whole job, and the
      // screen's own focus listener answers it SYNCHRONOUSLY
      // (`PeekTerminal.tsx`) with `onFocus(true)` → `setFocused`. Called
      // inline, that write lands in this apply arm's frame, so the foot —
      // which folds the same `driver` this arm's compute read with `typing()`
      // off `focused` — is written twice for one hand-over: the judged
      // `EFFECT_RELAY_TEAR`, `warn` from its third sighting, and taking the
      // terminal over three times in one open window is an ordinary thing to
      // do. An owner-less `onSettled` runs the focus after the flush settles,
      // in the same task, so nothing visible changes and no frame is lost. It
      // can never contend with the window's own mount focus below: this arm
      // requires a hand-over FROM the conductor, which the first run cannot
      // see.
      if (now.driver === "you" && before?.driver === "conductor")
        runWithOwner(null, () => {
          onSettled(() => {
            now.handle?.focus();
          });
        });
    },
    { name: "peekDriverKeyboard" },
  );
  /** THE READER'S KEYBOARD — while the terminal takes no typing the screen
   *  keeps DOM focus, so the keys a reader uses reach it: the scrollback
   *  keys, and the Esc xterm's key handler refuses when `mayType()` is false
   *  (`PeekTerminal.tsx`) so it bubbles out and closes the window. */
  createEffect(
    () => ({ handle: handle(), mayType: mayType() }),
    (now, before) => {
      const h = now.handle;
      if (h === undefined || now.mayType) return;
      // SETTLED, on the HAND BACK — the twin of `peekDriverKeyboard` above
      // and for the same reason: the screen answers `focus()` SYNCHRONOUSLY
      // with `onFocus(true)` → `setFocused`, so called inline from this arm
      // the write lands in the arm's own frame and the foot — which folds
      // the same `mayType` this compute read with `typing()` off `focused` —
      // is written twice for one hand back (`EFFECT_RELAY_TEAR`, victim
      // `p.children`, root `membership.driver`). An owner-less `onSettled`
      // runs it after the flush settles, in the same task.
      if (before?.mayType === true)
        runWithOwner(null, () => {
          onSettled(() => {
            h.focus();
          });
        });
      // THE WINDOW OPENING read-only is the other arrival here — the screen's
      // handle reaching a window that already takes no typing — and it stays
      // INLINE: the window's own mount focus below is an `onSettled` queued
      // at mount, so it runs after this flush and the window keeps the
      // keyboard, exactly as it does today. Settling this arrival too would
      // queue after that one and take the focus off the window instead.
      else h.focus();
    },
    { name: "peekReadOnlyFocus" },
  );
  let contentEl: HTMLDivElement | undefined;
  onSettled(() => {
    contentEl?.focus();
  });
  const blurTerminal = () => contentEl?.focus();
  const onWindowKey = (e: KeyboardEvent): void => {
    const target = e.target instanceof Element ? e.target : null;
    if (
      !keyRaisesLockOffer({
        key: e.key,
        modified: e.ctrlKey || e.metaKey || e.altKey,
        onButton: target?.closest("button") != null,
        terminalFocused: focused(),
        mayType: mayType(),
      })
    )
      return;
    e.preventDefault();
    personInputAt(ref);
  };
  const win = createWindowSize();
  const size = () => peekWindowSize(win);
  const availWidth = () =>
    layoutMode() === "phone" ? win.width : size().width - 2;

  const natural = createMemo(() => {
    const g = grid();
    const c = cell();
    const p = pad();
    return g && c && p ? peekNatural(g, c, p) : null;
  });
  const baseNatural = () => {
    const g = grid();
    const c = baseCell();
    const p = pad();
    return g && c && p ? peekNatural(g, c, p) : null;
  };
  const pans = () => {
    const n = baseNatural();
    return n !== null && peekPans(n.width, availWidth());
  };
  /** THE FONT THE SCREEN DRAWS AT — Fit width's answer at the window's base
   *  cell, else the base font. Read where it is bound, in the screen's
   *  `fontSize` prop: the base cell is latched from the font the screen
   *  reports WITH its measurement, so nothing re-derives this inside a
   *  render callback. */
  const fontSize = () => {
    const g = grid();
    const c = baseCell();
    const p = pad();
    return fitWidth() && g && c && p
      ? fitFontSize({
          cols: g.cols,
          cellWidth: c.width,
          fontSize: DEFAULT_FONT_SIZE,
          availWidth: availWidth(),
          padX: p.x,
        })
      : DEFAULT_FONT_SIZE;
  };
  const themeBackground = () => {
    const s = standing();
    return (
      getThemeByName(s.kind === "here" ? s.meta.themeName : undefined)
        .background ?? "var(--color-surface-0)"
    );
  };

  return (
    <Dialog.Content
      ref={(el: HTMLDivElement) => {
        contentEl = el;
      }}
      tabindex={-1}
      onKeyDown={onWindowKey}
      style={
        layoutMode() === "phone"
          ? {}
          : { width: `${size().width}px`, height: `${size().height}px` }
      }
      data-testid="terminal-peek"
      data-peek-host={props.target.host}
      data-peek-terminal={props.target.id}
      class="flex min-w-0 flex-col overflow-hidden rounded-xl border border-edge-bright bg-surface-1 shadow-2xl shadow-black/60 max-sm:h-[var(--app-h,100dvh)] max-sm:max-h-none max-sm:w-full max-sm:max-w-none max-sm:rounded-none max-sm:border-0 outline-none"
    >
      <div
        data-testid="peek-head"
        class="flex min-w-0 shrink-0 items-center gap-3 border-b border-edge px-3 py-2 max-sm:flex-wrap"
        onPointerDown={blurTerminal}
      >
        <Show
          when={tabs().length > 0}
          fallback={
            <span
              data-testid="peek-title"
              class="min-w-0 flex-1 truncate text-[0.78rem] font-semibold text-fg"
            >
              {name(ref)}
            </span>
          }
        >
          <div
            data-testid="peek-tabs"
            class="flex min-w-0 flex-1 items-end gap-0.5 overflow-x-auto max-sm:order-last max-sm:basis-full"
          >
            <For each={tabs()}>
              {(tab) => (
                <button
                  type="button"
                  data-testid="peek-tab"
                  data-ref={tab.ref}
                  data-active={tab.ref === ref ? "" : undefined}
                  data-openable={tab.openable ? "" : undefined}
                  disabled={!tab.openable}
                  class={`${TAB_CLASS} ${
                    tab.ref === ref
                      ? "border border-edge-bright bg-surface-0 font-semibold text-fg"
                      : tab.openable
                        ? "text-fg-2 hover:text-fg cursor-pointer"
                        : "text-fg-3"
                  }`}
                  onClick={() => openPeek({ host: tab.host, id: tab.id })}
                >
                  <span class="shrink-0 rounded-sm bg-conductor/15 px-1 font-mono text-[0.52rem] font-semibold uppercase tracking-[0.08em] text-conductor">
                    {ROLE_WORD[tab.role]}
                  </span>
                  {name(tab.ref)}
                  <Show when={!tab.openable}>
                    <span class="text-moonlit">☾ asleep</span>
                  </Show>
                </button>
              )}
            </For>
          </div>
        </Show>
        <TerminalControls
          kind="peek"
          host={props.target.host}
          id={props.target.id}
          pans={pans()}
          fit={fitWidth()}
          onFit={() => setFitWidth((was) => !was)}
          onOpenTile={() => {
            const at = props.target;
            closePeek();
            openTileAt(at);
          }}
        />
        <Show when={!typing()}>
          <span
            data-testid="peek-esc-hint"
            class="shrink-0 rounded-md border border-edge-bright border-b-2 bg-surface-2 px-1.5 py-0.5 font-mono text-[0.7rem] leading-none text-fg-2"
          >
            esc
          </span>
        </Show>
        <button
          type="button"
          data-testid="peek-close"
          aria-label="Close"
          class="flex h-6 w-6 shrink-0 cursor-pointer items-center justify-center rounded-md text-fg-2 hover:bg-surface-2 hover:text-fg"
          onClick={() => closePeek()}
        >
          ×
        </button>
      </div>
      <TerminalStatusLine
        kind="peek"
        lookable={lookable()}
        host={props.target.host}
        id={props.target.id}
        terminal={ref}
        driver={driver()}
        grid={grid()}
        phase={phase()}
        held={held()}
        onPointerDown={blurTerminal}
      />
      <div
        data-testid="peek-body"
        class="relative min-h-0 min-w-0 flex-1"
        style={{ background: themeBackground() }}
      >
        <Show
          when={lookable()}
          fallback={
            <div
              data-testid="peek-empty"
              data-standing={standing().kind}
              class="flex h-full w-full flex-col items-center justify-center gap-1 bg-surface-0 p-8 text-center text-[0.8rem] text-fg-2"
            >
              <b class="text-[0.9rem] text-fg">{status().state}</b>
              <span>There is no screen to show.</span>
            </div>
          }
        >
          <div
            data-testid="peek-scroller"
            class="h-full w-full overflow-x-auto overflow-y-hidden"
          >
            <div
              style={{
                width: natural() === null ? "100%" : `${natural()?.width}px`,
                "min-width": "100%",
                height:
                  natural() === null
                    ? "100%"
                    : `min(${natural()?.height}px, 100%)`,
              }}
            >
              <PeekTerminal
                host={props.target.host}
                id={props.target.id}
                fontSize={fontSize()}
                mayType={mayType}
                onGrid={setGrid}
                onCell={(c, p, drawnFont) => {
                  setCell(c);
                  setPad(p);
                  // THE FONT THIS CELL WAS DRAWN AT, as the screen states
                  // it: the base cell is the one measured at the base font,
                  // and nothing here reads the window's own staged state.
                  if (drawnFont === DEFAULT_FONT_SIZE) setBaseCell(c);
                }}
                onPhase={setPhase}
                onHeld={setHeld}
                onFocus={setFocused}
                onHandle={setHandle}
                testId="peek-screen"
              />
            </div>
          </div>
          <WorkLock terminal={ref} pill={false} />
        </Show>
      </div>
      <Show when={lookable()}>
        <p
          data-testid="peek-foot"
          onPointerDown={blurTerminal}
          class="m-0 shrink-0 border-t border-edge bg-surface-0 px-3 py-1 text-[0.62rem] text-fg-3"
        >
          {peekFootWords({
            driver: driver(),
            typing: typing(),
            name: name(ref),
            touch: isTouch(),
          })}
        </p>
      </Show>
      <Show when={isTouch() && lookable() && mayType()}>
        <MobileKeyBar target={props.target} />
      </Show>
    </Dialog.Content>
  );
};

export default TerminalPeek;
