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
 *  It is the peek's screen (`PeekTerminal`), so it never resizes the
 *  terminal, it draws it in its own colours, and a key reaches the terminal
 *  only while it is the person's — a key typed at a terminal the Conductor
 *  drives raises the lock's card over it (`WorkLock`, without its pill: the
 *  head carries Hand back). On a touch screen the key bar (`MobileKeyBar`,
 *  aimed at this terminal) is under it while the terminal is the person's:
 *  a key bar under a terminal that takes no keys would only raise the card.
 *
 *  It holds a read of the terminal's screen only while `connected`
 *  (`livePanes.ts` decides): a pane that is not on screen draws its head and
 *  nothing else. */

import { createElementSize } from "@solid-primitives/resize-observer";
import type { TerminalGrid } from "@kolu/xterm-kit/solid";
import type { WorkRole } from "kolu-work";
import { fleetTerminalRef } from "kolu-mcp/fleetRef";
import type { TerminalId } from "kolu-common/surface";
import {
  type Component,
  createMemo,
  createSignal,
  type JSX,
  on,
  createEffect,
  Show,
} from "solid-js";
import { DEFAULT_FONT_SIZE, getThemeByName } from "terminal-themes";
import MobileKeyBar from "../MobileKeyBar";
import { fleetTerminalStanding } from "../palette/fleetTerminals";
import { isTouch } from "../useMobile";
import { useMemberName } from "./memberNames";
import { inputAllowedAt } from "./personInput";
import { fitWidth, setFitWidth } from "./fitWidth";
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
    liveArm(standing())?.grid ?? null,
  );
  const [cell, setCell] = createSignal<PeekCell | null>(null);
  const [baseCell, setBaseCell] = createSignal<PeekCell | null>(null);
  const [pad, setPad] = createSignal<PeekPad | null>(null);
  const [phase, setPhase] = createSignal<ScreenPhase>("reading");
  const [held, setHeld] = createSignal(false);
  const [handle, setHandle] = createSignal<PeekTerminalHandle | undefined>(
    undefined,
  );

  /** TAKEN OVER, THE KEYBOARD GOES TO IT — the moment the terminal becomes
   *  the person's, wherever Take over was pressed. Not while the peek is up:
   *  the peek is in front of the pane, and it puts the keys in its own
   *  screen. */
  createEffect(
    on(driver, (now, before) => {
      if (now === "you" && before === "conductor" && peekTarget() === null)
        handle()?.focus();
    }),
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
  const fontSize = () => {
    const g = grid();
    const c = baseCell();
    const p = pad();
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
  const background = () => {
    const s = standing();
    return (
      getThemeByName(s.kind === "here" ? s.meta.themeName : undefined)
        .background ?? "var(--color-surface-0)"
    );
  };

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
                  if (fontSize() === DEFAULT_FONT_SIZE) setBaseCell(c);
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
