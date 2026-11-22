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
} from "solid-js";
import { FONT_FAMILY, getThemeByName } from "terminal-themes";
import { holdConductorScreen } from "../../attention/conductorScreens";
import { fleetTerminalStanding } from "../../palette/fleetTerminals";
import { runAction, runOwnedAction } from "../../runAction";
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
  const hostKey = decodeHostKey(props.host);
  const ref = fleetTerminalRef(props.host, props.id);
  const entry = padiMap.useEntry(() => hostKey);
  const shown = useShown();
  // A SCREEN OF THIS TERMINAL IS SHOWING IN THE CONDUCTOR, said here once for
  // Look and for a live pane alike, for as long as this part is mounted in a
  // view that is shown: what the attention engine reads to know the terminal
  // is in front of the person (`attention/conductorScreens.ts`).
  createEffect(() => {
    if (shown()) onCleanup(holdConductorScreen(ref));
  });
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
    createEffect(() => props.onHeld(h.scrollLock.isLocked()));

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
    createEffect(() => {
      if (!shown() || !tabVisible()) return;
      generation += 1;
      const mine = generation;
      const live = () => mine === generation;
      onCleanup(() => {
        generation += 1;
      });
      screen.reset();
      props.onPhase("reading");
      const again = () => {
        if (!live()) return;
        screen.reset();
        props.onPhase("reconnecting");
      };
      runOwnedAction(
        "peek attach",
        consumeReattachingStream(
          () =>
            unenrolledStreamCall(
              entry.streams.terminalAttach.unenrolled,
              peekAttachInput(props.id),
              {
                label: `terminalAttach[peek ${props.id}]`,
                onRetry: again,
              },
            ),
          (frame) => {
            if (!live()) return;
            applyPeekFrame(screen, frame);
            if (isSnapshotFrame(frame)) props.onPhase("live");
          },
          again,
          `Peek attach ${props.id}`,
          {
            hasExited: () => {
              const s = fleetTerminalStanding(props.host, props.id);
              return (
                s.kind === "gone" ||
                (s.kind === "here" && activeArm(s.meta) === undefined)
              );
            },
          },
        ).pipe(Effect.orDie),
      );
    });
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
