import { makeEventListener } from "@solid-primitives/event-listener";
import { isSnapshotFrame } from "@kolu/padi-client/attach";
import { activeArm } from "@kolu/padi-client/surface";
import { unenrolledStreamCall } from "@kolu/surface/client";
import {
  isReadingReport,
  isTerminalQueryResponse,
} from "@kolu/terminal-protocol";
import {
  type TerminalGrid,
  Xterm,
  type XtermHandle,
  measureGridBox,
} from "@kolu/xterm-kit/solid";
import { Effect } from "effect";
import { decodeHostKey } from "kolu-common/hostKey";
import { DEFAULT_SCROLLBACK } from "kolu-common/config";
import type { TerminalId } from "kolu-common/surface";
import { fleetTerminalRef } from "kolu-mcp/fleetRef";
import {
  type Component,
  createEffect,
  createSignal,
  onCleanup,
  untrack,
} from "solid-js";
import { FONT_FAMILY, getThemeByName } from "terminal-themes";
import { holdConductorScreen } from "../../attention/conductorScreens";
import { fleetTerminalStanding } from "../../palette/fleetTerminals";
import { runAction } from "../../runAction";
import { consumeReattachingStream } from "../../terminal/reattachingStream";
import { applyStickyModifiers } from "../../terminal/stickyModifiers";
import { useShown } from "../../ui/shown";
import { padiMap, padiRpcOf, preferences } from "../../wire";
import { personInputAt } from "../personInput";
import { applyPeekFrame, peekAttachInput, type PeekScreen } from "./peekAttach";
import type { PeekCell, PeekPad } from "./peekSize";

/** The keyboard door the window's own bars use to take Esc back from the terminal. */
export interface PeekTerminalHandle {
  focus(): void;
  blur(): void;
}

const PeekTerminal: Component<{
  host: string;
  id: TerminalId;
  fontSize: number;
  mayType: () => boolean;
  onGrid: (grid: TerminalGrid) => void;
  onCell: (cell: PeekCell, pad: PeekPad) => void;
  onPhase: (phase: "reading" | "live" | "reconnecting") => void;
  onHeld: (held: boolean) => void;
  onFocus: (focused: boolean) => void;
  onHandle: (handle: PeekTerminalHandle) => void;
  /** The screen's test id: `peek-screen` in the peek, `live-screen` in a
   *  picked work's pane, so the two views of one terminal are told apart. */
  testId: "peek-screen" | "live-screen";
}> = (props) => {
  // The terminal this screen is of is the pane's FIXED wiring (the attach
  // effect below says the same of it): the host key and the fleet ref are
  // taken at mount. Neither prop is reactive — both panes hand down a plain
  // member ref — so the body reads nothing it must depend on.
  const hostKey = decodeHostKey(props.host);
  const ref = fleetTerminalRef(props.host, props.id);
  const entry = padiMap.useEntry(() => hostKey);
  const shown = useShown();
  // A SCREEN OF THIS TERMINAL IS SHOWING IN THE CONDUCTOR, said here once for
  // Look and for a live pane alike, for as long as this part is mounted in a
  // view that is shown: what the attention engine reads to know the terminal
  // is in front of the person (`attention/conductorScreens.ts`).
  createEffect(
    () => shown(),
    (isShown) => (isShown ? holdConductorScreen(ref) : undefined),
  );
  const [tabVisible, setTabVisible] = createSignal(
    document.visibilityState === "visible",
  );
  makeEventListener(document, "visibilitychange", () =>
    setTabVisible(document.visibilityState === "visible"),
  );
  const theme = () => {
    const s = fleetTerminalStanding(props.host, props.id);
    return getThemeByName(s.kind === "here" ? s.meta.themeName : undefined);
  };

  const onData = (data: string): void => {
    if (isTerminalQueryResponse(data)) return;
    if (!isReadingReport(data) && !personInputAt(ref)) return;
    runAction(
      "send input",
      padiRpcOf(hostKey)
        .lifecycle.sendInput({ id: props.id, data: applyStickyModifiers(data) })
        .pipe(Effect.ignore),
    );
  };

  const onReady = (h: XtermHandle): void => {
    (h.container as HTMLElement & { __xterm?: unknown }).__xterm = h.terminal;
    onCleanup(() => {
      (h.container as HTMLElement & { __xterm?: unknown }).__xterm = undefined;
    });
    props.onHandle({
      focus: () => h.terminal.focus(),
      blur: () => h.terminal.blur(),
    });
    h.terminal.attachCustomKeyEventHandler(
      (e) => !(e.key === "Escape" && !props.mayType()),
    );
    const textarea = h.terminal.textarea;
    if (textarea) {
      makeEventListener(textarea, "focus", () => props.onFocus(true));
      makeEventListener(textarea, "blur", () => props.onFocus(false));
    }
    createEffect(
      () => ({
        held: h.scrollLock.isLocked(),
        // READ ONCE, not depended on: a callback prop is the door this fact
        // leaves through, never a reason to report it again.
        report: untrack(() => props.onHeld),
      }),
      ({ held, report }) => report(held),
    );

    let lastWidth = Number.NaN;
    let lastHeight = Number.NaN;
    let lastPadX = Number.NaN;
    let lastPadY = Number.NaN;
    const reportCell = (): void => {
      const d = h.terminal.dimensions;
      const box = measureGridBox(h.terminal, h.container);
      if (!d || !box) return;
      const width = d.css.cell.width;
      const height = d.css.cell.height;
      const padX = box.paddingHorizontal + box.scrollbarWidth;
      const padY = box.paddingVertical;
      if (
        width === lastWidth &&
        height === lastHeight &&
        padX === lastPadX &&
        padY === lastPadY
      )
        return;
      lastWidth = width;
      lastHeight = height;
      lastPadX = padX;
      lastPadY = padY;
      props.onCell({ width, height }, { x: padX, y: padY });
    };
    const sub = h.terminal.onRender(reportCell);
    onCleanup(() => sub.dispose());

    const screen: PeekScreen = {
      resize: (grid) => {
        h.resize(grid);
        props.onGrid(grid);
      },
      write: (data) => h.write(data, () => h.recovery.noteData()),
      reset: () => {
        h.clearPendingOutput();
        h.scrollLock.reset("drop");
        h.terminal.reset();
      },
    };
    let generation = 0;
    createEffect(
      () => ({
        shown: shown(),
        tabVisible: tabVisible(),
        // READ ONCE, not depended on: the attach is restarted by `shown` and
        // `tabVisible` and by NOTHING else — the terminal this screen is of
        // and the callbacks the phases leave through are the pane's fixed
        // wiring, and the effect's phase may read no reactive state at all.
        // A single-phase effect here re-attaches on every scroll-lock change,
        // which throws a scrolled-back view to the bottom.
        id: untrack(() => props.id),
        host: untrack(() => props.host),
        onPhase: untrack(() => props.onPhase),
        // The door, read plainly: walking `streams.<member>.<verb>` on a
        // surface-map entry reads nothing reactive — it hands back a call
        // that resolves this host's CURRENT per-key client when it is MADE
        // (`surface-map/src/client.ts:548-557`, `:1049-1060`). So a host
        // re-added under this pane is attached through the new membership
        // without this effect re-running, and there is nothing here that can
        // go stale.
        attach: entry.streams.terminalAttach.unenrolled,
      }),
      ({
        shown: isShown,
        tabVisible: isTabVisible,
        id,
        host,
        onPhase,
        attach,
      }) => {
        if (!isShown || !isTabVisible) return;
        generation += 1;
        const mine = generation;
        const live = () => mine === generation;
        screen.reset();
        onPhase("reading");
        const again = () => {
          if (!live()) return;
          screen.reset();
          onPhase("reconnecting");
        };
        // `runAction` with the fiber interrupted below, rather than
        // `runOwnedAction`: an effect's imperative half owns its work through
        // the cleanup it returns, which is what stops the attach before the
        // next one and on disposal.
        const fiber = runAction(
          "peek attach",
          consumeReattachingStream(
            () =>
              unenrolledStreamCall(attach, peekAttachInput(id), {
                label: `terminalAttach[peek ${id}]`,
                onRetry: again,
              }),
            (frame) => {
              if (!live()) return;
              applyPeekFrame(screen, frame);
              if (isSnapshotFrame(frame)) onPhase("live");
            },
            again,
            `Peek attach ${id}`,
            {
              hasExited: () => {
                const s = fleetTerminalStanding(host, id);
                return (
                  s.kind === "gone" ||
                  (s.kind === "here" && activeArm(s.meta) === undefined)
                );
              },
            },
          ).pipe(Effect.orDie),
        );
        return () => {
          generation += 1;
          fiber.interruptUnsafe();
        };
      },
    );
  };

  return (
    <Xterm
      theme={theme()}
      fontSize={props.fontSize}
      visible={true}
      boxDecided={true}
      webgl={() => false}
      scrollLockEnabled={() => preferences().scrollLock}
      fullRate={() => true}
      fontFamily={FONT_FAMILY}
      terminalOptions={{
        scrollback: DEFAULT_SCROLLBACK,
        cursorBlink: true,
        allowProposedApi: true,
      }}
      onData={onData}
      onReady={onReady}
      onTap={() => false}
      class="h-full w-full overflow-hidden touch-manipulation"
      data-testid={props.testId}
    />
  );
};

export default PeekTerminal;
