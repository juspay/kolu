/** ONE TERMINAL OF THE PICKED WORK, LIVE — the screen as it is now, under
 *  the same head the peek draws (`peek/TerminalHead.tsx`): who drives it,
 *  **Take over** or **Hand back**, **Fit width** and **Open tile ↗**.
 *
 *  **Fit width** is NOT this pane's signal: it is one choice for every pane
 *  — this one and Look (`fitWidth.ts`) — on from the start and kept in
 *  `localStorage`, so a view switch, another work or another session does
 *  not put the screen back to a sideways scroller with a button to press
 *  again.
 *
 *  It draws the peek's screen (`PeekTerminal`), whose attach asks for no
 *  size; on a desktop the PANE sets the terminal's size (`paneSize.ts`), and
 *  on a phone or a tablet it follows. It draws the terminal in its own
 *  colours, and a key reaches the terminal only while it is the person's — a
 *  key typed at a terminal the Conductor drives raises the lock's card over
 *  it (`WorkLock`, without its pill: the head carries Hand back). On a touch
 *  screen the key bar (`MobileKeyBar`, aimed at this terminal) is under it
 *  while the terminal is the person's: a key bar under a terminal that takes
 *  no keys would only raise the card.
 *
 *  It holds a read of the terminal's screen only while `connected`
 *  (`livePanes.ts` decides): a pane that is not on screen draws its head and
 *  nothing else. */

import { createElementSize } from "@solid-primitives/resize-observer";
import { sameGrid, type TerminalGrid } from "@kolu/xterm-kit/solid";
import type { WorkRole } from "kolu-work";
import { fleetTerminalRef } from "kolu-mcp/fleetRef";
import { decodeHostKey } from "kolu-common/hostKey";
import type { TerminalId } from "kolu-common/surface";
import type { JSX } from "@solidjs/web";
import {
  type Component,
  createMemo,
  createSignal,
  createEffect,
  onCleanup,
  Show,
  untrack,
} from "solid-js";
import { DEFAULT_FONT_SIZE, getThemeByName } from "terminal-themes";
import MobileKeyBar from "../MobileKeyBar";
import { fleetTerminalStanding } from "../palette/fleetTerminals";
import { runAction } from "../runAction";
import { FOREIGN_GRID_SETTLE_MS } from "../terminal/foreignGrid";
import { createGridPublisher } from "../terminal/publishGrid";
import { isDesktop, isTouch } from "../useMobile";
import { padiMap, padiRpcOf } from "../wire";
import { useMemberName } from "./memberNames";
import { inputAllowedAt } from "./personInput";
import { fitWidth, setFitWidth } from "./fitWidth";
import { createPaneSize, paneGrid } from "./paneSize";
import { createResizeOffer } from "./resizeOffer";
import PeekTerminal, { type PeekTerminalHandle } from "./peek/PeekTerminal";
import {
  type PeekCell,
  type PeekPad,
  fitFontSize,
  peekNatural,
  peekPans,
} from "./peek/peekSize";
import {
  type ScreenPhase,
  TerminalControls,
  TerminalStatusLine,
} from "./peek/TerminalHead";
import { peekTarget } from "./peek/usePeek";
import { inspectMember } from "./workListing";
import { liveArm, terminalStatus } from "./terminalStatus";
import { useOpenTile } from "./useOpenTile";
import { useMembership } from "./useWorks";
import WorkLock from "./WorkLock";
import { ROLE_WORD } from "./workReadings";

const LivePane: Component<{
  host: string;
  id: TerminalId;
  role: WorkRole;
  /** Holding a read of the screen: the pane is on screen. */
  connected: boolean;
  /** Its height, set by the view that lays the panes out. */
  height: string;
  /** The tab row, when the panes are tabbed: drawn above the head. */
  tabs?: JSX.Element;
}> = (props) => {
  const ref = () => fleetTerminalRef(props.host, props.id);
  const name = useMemberName();
  const membership = useMembership();
  const openTileAt = useOpenTile();
  const standing = createMemo(() =>
    fleetTerminalStanding(props.host, props.id),
  );
  const lookable = () => liveArm(standing()) !== undefined;
  const driver = () => membership().get(ref())?.driver ?? "nobody";
  const mayType = () => inputAllowedAt(ref());

  const [grid, setGrid] = createSignal<TerminalGrid | null>(
    // READ ONCE: the pane opens on the size the terminal has now, and every
    // size after this one arrives through `onGrid`.
    untrack(() => liveArm(standing())?.grid ?? null),
  );
  const [cell, setCell] = createSignal<PeekCell | null>(null);
  const [baseCell, setBaseCell] = createSignal<PeekCell | null>(null);
  const [pad, setPad] = createSignal<PeekPad | null>(null);
  const [phase, setPhase] = createSignal<ScreenPhase>("reading");
  const [held, setHeld] = createSignal(false);
  /** The screen's keyboard door, handed up by `PeekTerminal`'s `onReady`.
   *  `ownedWrite`: this is the pane's OWN internal signal, and `onReady` runs
   *  under the pane's owner (the kit re-enters it with `runWithOwner` once the
   *  font has loaded, `xterm-kit/solid/xtermLifecycle.ts`) — so the one write
   *  it ever takes is, by construction, a write in an owned scope. */
  const [handle, setHandle] = createSignal<PeekTerminalHandle | undefined>(
    undefined,
    { ownedWrite: true },
  );

  /** TAKEN OVER, THE KEYBOARD GOES TO IT — the moment the terminal becomes
   *  the person's, wherever Take over was pressed. Not while the peek is up:
   *  the peek is in front of the pane, and it puts the keys in its own
   *  screen. */
  createEffect(
    () => ({
      driver: driver(),
      // READ ONCE, not depended on: the keyboard follows the DRIVER
      // changing — a peek opening, or the screen's handle arriving, is not a
      // reason to take the keys.
      peeking: untrack(() => peekTarget() !== null),
      handle: untrack(handle),
    }),
    (now, before) => {
      if (
        now.driver === "you" &&
        before?.driver === "conductor" &&
        !now.peeking
      )
        now.handle?.focus();
    },
  );

  const [body, setBody] = createSignal<HTMLDivElement>();
  const bodySize = createElementSize(body);
  const availWidth = () => bodySize.width ?? 0;
  const natural = createMemo(() => {
    const g = grid();
    const c = cell();
    const p = pad();
    return g && c && p ? peekNatural(g, c, p) : null;
  });
  const pans = () => {
    const g = grid();
    const c = baseCell();
    const p = pad();
    return g && c && p
      ? peekPans(peekNatural(g, c, p).width, availWidth())
      : false;
  };
  /** THE FONT THE SCREEN DRAWS AT, FOR A GIVEN PAD — Fit width's answer at the
   *  pane's base cell, else the base font.
   *
   *  The pad is an ARGUMENT, not a read: `onCell` below judges this with the
   *  pad it has just been handed, and a Solid 2 signal write is staged until
   *  the flush, so reading `pad()` there would answer with the pad BEFORE the
   *  report — latching the base cell against a measurement it was not taken
   *  at. */
  const fontSizeFor = (p: PeekPad | null): number => {
    const g = grid();
    const c = baseCell();
    return fitWidth() && g && c && p && availWidth() > 0
      ? fitFontSize({
          cols: g.cols,
          cellWidth: c.width,
          fontSize: DEFAULT_FONT_SIZE,
          availWidth: availWidth(),
          padX: p.x,
        })
      : DEFAULT_FONT_SIZE;
  };
  const fontSize = () => fontSizeFor(pad());
  const background = () => {
    const s = standing();
    return (
      getThemeByName(s.kind === "here" ? s.meta.themeName : undefined)
        .background ?? "var(--color-surface-0)"
    );
  };

  /** THE GRID THIS PANE WOULD ASK FOR — its body at the base font's cell,
   *  never below 80×24 (`paneGrid`). The BASE cell, never the drawn one: a
   *  pane Fit width has shrunk would otherwise shrink an already shrunk cell.
   *  Value-compared, so a re-measure that finds the same grid is no change. */
  const asked = createMemo<TerminalGrid | null>(
    () =>
      paneGrid({
        width: bodySize.width ?? 0,
        height: bodySize.height ?? 0,
        cell: baseCell(),
        pad: pad(),
        fontSize: DEFAULT_FONT_SIZE,
        fit: fitWidth(),
      }),
    { equals: (a, b) => (a && b ? sameGrid(a, b) : a === b) },
  );
  const hostState = () => padiMap.entry(decodeHostKey(props.host)).state().kind;
  /** The pane's own publisher: the tile's settle and host-down latch, aimed at
   *  `lifecycle.resize` on the terminal's own host. */
  const publisher = createGridPublisher({
    terminalId: props.id,
    hostState,
    ptyLive: lookable,
    resize: (g) =>
      padiRpcOf(decodeHostKey(props.host)).lifecycle.resize({
        id: props.id,
        cols: g.cols,
        rows: g.rows,
      }),
    run: (action) => {
      runAction("publish terminal grid", action);
    },
  });
  onCleanup(publisher.cancel);
  const onScreen = () => props.connected && lookable();
  const paneSize = createPaneSize({
    publish: publisher.publish,
    cancelPublish: publisher.cancel,
    restateOwed: publisher.republishSuppressed,
  });
  createEffect(
    () => ({
      connected: onScreen(),
      desktop: isDesktop(),
      asked: asked(),
      // The host coming back is what makes a suppressed publish worth
      // restating, and the gate is judged against this word.
      hostState: hostState(),
    }),
    ({ connected, desktop, asked: grid, hostState: host }) => {
      paneSize.observe({ connected, desktop, asked: grid, hostState: host });
    },
  );
  /** THE ONE PRESS (the head's readout, offered once the terminal has stayed
   *  at a size this pane would not ask for — `resizeOffer.ts`): publish that
   *  size once. It is how a phone's or a tablet's pane, which follows, takes
   *  the size — and how a desktop pane takes it back from a viewer that took
   *  it since. */
  const resizeToFit = () => {
    const g = asked();
    if (g) publisher.publish(g);
  };
  const [resizeOffered, setResizeOffered] = createSignal(false);
  /** The terminal's REAL size: its record's, never the drawn screen's, which
   *  lags behind the scroll lock. */
  const realGrid = () => liveArm(standing())?.grid;
  const offer = createResizeOffer({
    settleMs: FOREIGN_GRID_SETTLE_MS,
    show: setResizeOffered,
  });
  onCleanup(offer.dispose);
  createEffect(
    () => ({ real: realGrid(), asked: asked() }),
    (now) => {
      offer.observe(now);
    },
  );

  return (
    <section
      data-testid="live-pane"
      data-ref={ref()}
      data-role={props.role}
      data-connected={props.connected && lookable() ? "" : undefined}
      class="flex min-w-0 flex-col overflow-hidden rounded-xl border border-edge bg-surface-1"
      style={{ height: props.height }}
    >
      {props.tabs}
      <div class="flex min-w-0 shrink-0 items-center gap-2 border-b border-edge px-3 py-1.5">
        <span class="shrink-0 text-[0.78rem] font-semibold text-fg">
          {ROLE_WORD[props.role]}
        </span>
        <span class="min-w-0 flex-1 truncate font-mono text-[0.66rem] text-fg-3">
          {name(ref())}
        </span>
        {/* INSPECT: this terminal's row in the work's Details, held open —
            what the Right panel says about a terminal, for this one. */}
        <button
          type="button"
          data-testid="live-inspect"
          class="shrink-0 cursor-pointer rounded-md border border-edge-bright bg-surface-0 px-2 py-0.5 text-[0.7rem] text-fg-2 hover:text-fg"
          onClick={() => inspectMember(ref())}
        >
          Inspect
        </button>
        <TerminalControls
          kind="live"
          host={props.host}
          id={props.id}
          pans={pans()}
          fit={fitWidth()}
          onFit={() => setFitWidth((was) => !was)}
          onOpenTile={() => openTileAt({ host: props.host, id: props.id })}
        />
      </div>
      <TerminalStatusLine
        kind="live"
        host={props.host}
        id={props.id}
        terminal={ref()}
        driver={driver()}
        grid={grid()}
        phase={phase()}
        held={held()}
        resize={{ offered: resizeOffered(), onPress: resizeToFit }}
      />
      <div
        ref={setBody}
        class="relative min-h-0 min-w-0 flex-1"
        style={{ background: background() }}
      >
        <Show
          when={lookable() && props.connected}
          fallback={
            <div class="flex h-full w-full flex-col items-center justify-center gap-1 bg-surface-0 p-6 text-center text-[0.8rem] text-fg-2">
              <b class="text-[0.9rem] text-fg">
                {terminalStatus(standing()).state}
              </b>
              <Show when={!lookable()}>
                <span>There is no screen to show.</span>
              </Show>
            </div>
          }
        >
          <div
            data-testid="live-scroller"
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
                host={props.host}
                id={props.id}
                fontSize={fontSize()}
                mayType={mayType}
                onGrid={setGrid}
                onCell={(c, p) => {
                  setCell(c);
                  setPad(p);
                  if (fontSizeFor(p) === DEFAULT_FONT_SIZE) setBaseCell(c);
                }}
                onPhase={setPhase}
                onHeld={setHeld}
                onFocus={() => {}}
                onHandle={setHandle}
                testId="live-screen"
              />
            </div>
          </div>
          <WorkLock terminal={ref()} pill={false} />
        </Show>
      </div>
      <Show when={isTouch() && lookable() && props.connected && mayType()}>
        <MobileKeyBar target={{ host: props.host, id: props.id }} />
      </Show>
    </section>
  );
};

export default LivePane;
