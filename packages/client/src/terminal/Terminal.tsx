import { writeTextToClipboard } from "@kolu/solid-logtail";
import { makeEventListener } from "@solid-primitives/event-listener";
import { ClipboardAddon } from "@xterm/addon-clipboard";
import type { ITheme, Terminal as XTerm } from "@xterm/xterm";
import {
  type Component,
  createEffect,
  createSignal,
  on,
  onCleanup,
  Show,
} from "solid-js";
import { toast } from "solid-sonner";
import { match } from "ts-pattern";
import { SafeClipboardProvider } from "../ui/clipboard";
import { registerTerminalElement } from "./terminalElements";
import "@xterm/xterm/css/xterm.css";
import "kolu-common/test-hooks";
import { TERMINAL_RESET } from "@kolu/padi/endpoint";
import {
  frameGrid,
  isResizedFrame,
  isSnapshotFrame,
} from "@kolu/padi-client/attach";
import { type AttachCause, activeArm } from "@kolu/padi-client/surface";
import { rejectionFor, sizeRejectionFor } from "@kolu/padi-client/upload";
import { unenrolledStreamCall } from "@kolu/surface/client";
import { toError } from "@kolu/surface/run-stream";
import {
  isReadingReport,
  isTerminalQueryResponse,
  wrapBracketedPaste,
} from "@kolu/terminal-protocol";
import {
  type BackfillController,
  createBackfillController,
} from "@kolu/xterm-kit/backfill";
import { cellAtPoint, readBufferBytes } from "@kolu/xterm-kit/internals";
import { Xterm, type XtermHandle } from "@kolu/xterm-kit/solid";
import { Effect, type Fiber } from "effect";
import { DEFAULT_SCROLLBACK } from "kolu-common/config";
import type { TerminalId } from "kolu-common/surface";
import { FONT_FAMILY } from "terminal-themes";
import { activeTerminalRef, personInput } from "../conductor/personInput";
import WorkLock from "../conductor/WorkLock";
import {
  ACTIONS,
  matchesAnyShortcut,
  TERMINAL_SEARCH_ATTR_PROP,
} from "../input/actions";
import { matchesKeybind } from "../input/keyboard";
import { createZoom } from "../input/zoom";
import { refitOnTabVisible } from "../refitOnTabVisible";
import { openInCodeTab } from "../right-panel/openInCodeTab";
import { isDeclared, TERMINAL_NOT_FOUND } from "../rpc/declaredErrors";
import { runAction, runActionPromise, type UiAction } from "../runAction";
import type { LineRef } from "../ui/lineRef";
import { isTouch } from "../useMobile";
import {
  activeHost,
  activePadiRpc,
  activePadiStreams,
  padiMap,
  preferences,
} from "../wire";
import { createAttemptGate, onlyWhenCurrent } from "./attachAttempts";
import {
  createFileRefLinkProvider,
  fileRefAtCell,
} from "./fileRefLinkProvider";
import { installTerminalFocusProvenance } from "./focusProvenance";
import { createForeignGridWatcher } from "./foreignGrid";
import { handleWebLink } from "./handleWebLink";
import { PrintedUrlCardMount } from "./PrintedUrlCard";
import { deliverScratchPaste } from "./pasteDelivery";
import { trackPrintedPorts } from "./printedPorts";
import { createGridPublisher, GRID_SETTLE_MS } from "./publishGrid";
import {
  consumeReattachingStream,
  REATTACH_BACKOFF_MS,
} from "./reattachingStream";
import ScrollToBottom from "./ScrollToBottom";
import SearchBar from "./SearchBar";
import { createShownPane } from "./shownPane";
import { applyStickyModifiers } from "./stickyModifiers";
import { registerTerminalRefs, unregisterTerminalRefs } from "./terminalRefs";
import { registerDiagnostics } from "./useTerminalDiagnostics";
import { useTerminalStore } from "./useTerminalStore";
import {
  trackCreate,
  trackDispose,
  trackLoseContextCalled,
} from "./webglTracker";

export const lifecycleCounters = { mounts: 0, cleanups: 0 };

/** ArrayBuffer → base64 without stack overflow (spread on large arrays blows the stack). */
function bufferToBase64(buf: ArrayBuffer): string {
  return btoa(
    Array.from(new Uint8Array(buf), (b) => String.fromCharCode(b)).join(""),
  );
}

function errMsg(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

function exposeTerminalForE2E(
  container: HTMLElement,
  term: XTerm | undefined,
): void {
  (container as HTMLDivElement).__xterm = term;
}

type TerminalKeyVerdict = "xterm" | "browser" | "copySelection";

function armsScrollIntent(e: KeyboardEvent): boolean {
  return (
    e.type === "keydown" &&
    e.shiftKey &&
    (e.key === "PageUp" || e.key === "PageDown")
  );
}

function terminalKeyPolicy(e: KeyboardEvent): TerminalKeyVerdict {
  if (e.metaKey) {
    const key = e.key.toLowerCase();
    return (key === "c" || key === "v") && !e.shiftKey ? "xterm" : "browser";
  }
  if (e.ctrlKey && e.key === "v") return "browser";
  if (matchesKeybind(e, ACTIONS.copySelection.keybind)) return "copySelection";
  if (matchesAnyShortcut(e)) return "browser";
  return "xterm";
}

interface AttachAttempt {
  live(): boolean;
  supersede(): void;
  reassertGrid(): void;
}

const GRID_ROUND_TRIP_BUDGET_MS = 500;
const FOREIGN_GRID_SETTLE_MS = GRID_SETTLE_MS + GRID_ROUND_TRIP_BUDGET_MS;

const Terminal: Component<{
  terminalId: TerminalId;
  visible: boolean;
  boxDecided: boolean;
  /** When true, this terminal should grab keyboard focus. */
  focused?: boolean;
  refocusNonce?: number;
  theme: ITheme;
  searchOpen: boolean;
  onSearchOpenChange: (open: boolean) => void;
  onFocus?: () => void;
  isSub?: boolean;
}> = (props) => {
  lifecycleCounters.mounts++;
  let linkProviderDisposable: { dispose(): void } | null = null;
  let backfill: BackfillController | null = null;
  let attachFiber: Fiber.Fiber<unknown, never> | null = null;
  let attachTornDown = false;
  let reassertTimer: ReturnType<typeof setTimeout> | null = null;
  let liveAttempt: AttachAttempt | null = null;
  let disposeDiagnostics: (() => void) | null = null;
  let webglTrackerId: number | null = null;
  const [handle, setHandle] = createSignal<XtermHandle | null>(null);
  const terminalStore = useTerminalStore();

  const isFocused = () => props.focused === true;
  const fontSize = createZoom(props.terminalId, isFocused);

  const canUseWebgl = () =>
    props.visible && terminalStore.holdsWebgl(props.terminalId);
  const shouldUseWebgl = () =>
    match(preferences().terminalRenderer)
      .with("auto", canUseWebgl)
      .with("webgl", () => true)
      .with("dom", () => false)
      .exhaustive();

  function focusOnSelection() {
    if (isTouch()) return;
    handle()?.terminal?.focus();
  }

  function activateFileRef(ref: LineRef) {
    const meta = terminalStore.getMetadata(props.terminalId);
    if (!meta) return;
    openInCodeTab({
      terminalId: props.terminalId,
      ref,
      cwd: meta?.cwd,
      targetMode: "browse",
    });
  }

  const onTap = (clientX: number, clientY: number): boolean => {
    const term = handle()?.terminal;
    if (!term) return false;
    const cell = cellAtPoint(term, clientX, clientY);
    if (!cell) return false;
    const bufferLine = term.buffer.active.viewportY + cell.row;
    const ref = fileRefAtCell(term, cell.col, bufferLine);
    if (ref) {
      activateFileRef(ref);
      return true;
    }
    return false;
  };

  const hostEntryKind = () => padiMap.entry(activeHost()).state().kind;

  const gridPublisher = createGridPublisher({
    terminalId: props.terminalId,
    hostState: hostEntryKind,
    ptyLive: () =>
      activeArm(terminalStore.getMetadata(props.terminalId)) !== undefined,
    resize: (grid) =>
      activePadiRpc.lifecycle.resize({
        id: props.terminalId,
        cols: grid.cols,
        rows: grid.rows,
      }),
    run: (action) => {
      runAction("publish terminal grid", action);
    },
  });

  const onReady = (h: XtermHandle) => {
    onCleanup(registerTerminalElement(props.terminalId, h.container));
    setHandle(h);
    const term = h.terminal;

    exposeTerminalForE2E(h.container, term);

    const printedPorts = trackPrintedPorts(term, props.terminalId);

    onCleanup(() => {
      attachTornDown = true;
      closeAttachStream();
      gridPublisher.cancel();
      unregisterTerminalRefs(props.terminalId);
      disposeDiagnostics?.();
      disposeDiagnostics = null;
      linkProviderDisposable?.dispose();
      linkProviderDisposable = null;
      printedPorts.dispose();
      backfill?.dispose();
      backfill = null;
      exposeTerminalForE2E(h.container, undefined);
      setHandle(null);
    });

    linkProviderDisposable = term.registerLinkProvider(
      createFileRefLinkProvider(term, { onActivate: activateFileRef }),
    );
    term.loadAddon(new ClipboardAddon(undefined, new SafeClipboardProvider()));

    registerTerminalRefs(props.terminalId, {
      xterm: term,
      serialize: h.addons.serialize,
      probes: {
        webglAtlas: () => h.webgl.textureAtlasSize(),
        bufferBytes: () => readBufferBytes(term),
        scrollLockEvents: () => h.scrollLock.events(),
        ...h.recovery.probes,
      },
    });
    disposeDiagnostics = registerDiagnostics(props.terminalId, {
      renderer: () => (h.webgl.hasWebgl() ? "webgl" : "dom"),
      term: h.termGrid,
      wanted: h.wantedGrid,
      scrollLock: {
        locked: h.scrollLock.isLocked,
        pendingChunks: h.scrollLock.pendingChunks,
        lastEvent: h.scrollLock.lastEvent,
      },
    });

    term.attachCustomKeyEventHandler((e: KeyboardEvent) => {
      if (armsScrollIntent(e)) h.scrollLock.armUserScrollIntent("keyboard");

      const verdict = terminalKeyPolicy(e);
      if (verdict !== "copySelection") return verdict === "xterm";

      e.preventDefault();
      const selection = term.getSelection();
      if (selection)
        runAction(
          "copy selection",
          writeTextToClipboard(selection).pipe(
            Effect.tap(() =>
              Effect.sync(() => toast.success("Copied selection to clipboard")),
            ),
            Effect.catch((err) =>
              Effect.sync(() => {
                console.error("Failed to copy selection:", err);
                toast.error(
                  `Failed to copy selection: ${toError(err).message}`,
                );
              }),
            ),
          ),
        );
      return false;
    });

    if (term.textarea) {
      onCleanup(
        installTerminalFocusProvenance({
          pane: h.container,
          textarea: term.textarea,
          isFocused: () => props.focused === true,
          onFocus: () => props.onFocus?.(),
        }),
      );
    }

    refitOnTabVisible(
      () => {
        h.refit();
        h.webgl.clearTextureAtlas();
        h.scrollLock.handleTabVisible();
        h.recovery.recover();
      },
      () => props.visible,
    );

    backfill = createBackfillController(term, {
      fetch: (before, max, epoch) =>
        runActionPromise(
          activePadiRpc.screen.history({
            id: props.terminalId,
            before,
            max,
            // SPREAD, never `epoch` outright (#17): the field is
            // `Schema.optionalKey` on the wire, so an ABSENT key is accepted and
            // a present-but-`undefined` one is REJECTED — where zod's
            // `.optional()` took either. A snapshot that carried no
            // `reflowEpoch` seeds this `undefined`, which is the ordinary
            // first-attach case, so spelling it out would throw at the first
            // backfill fetch.
            ...(epoch !== undefined && { epoch }),
          }),
        ),
      isTerminalGone: (err) => isDeclared(err, TERMINAL_NOT_FOUND),
      onPrepended: () => printedPorts.notePrepended(),
      onError: (err) =>
        toast.error(
          `Failed to load older scrollback: ${err instanceof Error ? err.message : String(err)}`,
        ),
    });

    const clearPipelines = () => {
      h.clearPendingOutput();
      h.scrollLock.reset("drop");
      backfill?.reset();
    };
    const blankScreenAndClear = () => {
      clearPipelines();
      handle()?.terminal?.reset();
    };
    const shown = () => h.wantedGrid() !== null && props.visible;
    const shownPane = createShownPane({
      shown,
      attach: () => {
        clearPipelines();
        openAttachStream({ cause: "attach", repaint: true });
      },
      detach: closeAttachStream,
      publish: gridPublisher.publish,
      cancelPublish: gridPublisher.cancel,
    });
    createEffect(on(shown, () => shownPane.observe()));

    createEffect(
      on(h.wantedGrid, (measured) => {
        if (measured) shownPane.measured(measured);
      }),
    );

    const foreignGrid = createForeignGridWatcher({
      served: () =>
        activeArm(terminalStore.getMetadata(props.terminalId))?.grid,
      mine: h.wantedGrid,
      hostState: hostEntryKind,
      reopen: () => liveAttempt?.reassertGrid(),
      settleMs: FOREIGN_GRID_SETTLE_MS,
    });
    onCleanup(() => foreignGrid.dispose());
    createEffect(
      on(
        () => activeArm(terminalStore.getMetadata(props.terminalId))?.grid,
        () => foreignGrid.observe(),
      ),
    );

    createEffect(
      on(hostEntryKind, (kind) => {
        if (kind === "connected") gridPublisher.republishSuppressed();
      }),
    );

    const attempts = createAttemptGate();

    type OpenReason = { cause: AttachCause; repaint: boolean };

    function openAttachStream(why: OpenReason) {
      const attempt = attempts.open();
      let superseded = false;
      let repaintOwed = why.repaint;
      let causeOwed: AttachCause | null = why.cause;

      const attemptLive = () =>
        attempt.isCurrent() && !superseded && !attachTornDown;

      const resetIfLive = onlyWhenCurrent(
        { isCurrent: attemptLive },
        blankScreenAndClear,
      );

      const reassertWantedGrid = () => {
        superseded = true;
        attachFiber?.interruptUnsafe();
        blankScreenAndClear();
        clearTimeout(reassertTimer ?? undefined);
        reassertTimer = setTimeout(() => {
          reassertTimer = null;
          if (attachTornDown) return;
          openAttachStream({ cause: "foreign", repaint: false });
        }, REATTACH_BACKOFF_MS);
      };

      liveAttempt = {
        live: attemptLive,
        supersede: () => {
          superseded = true;
        },
        reassertGrid: onlyWhenCurrent(
          { isCurrent: attemptLive },
          reassertWantedGrid,
        ),
      };

      const consume = consumeReattachingStream(
        () => {
          const measured = h.wantedGrid();
          if (!measured) {
            throw new Error(
              `terminal ${props.terminalId}: attach opened without a measured grid`,
            );
          }
          const cause = causeOwed ?? "attach";
          causeOwed = null;
          return unenrolledStreamCall(
            activePadiStreams.terminalAttach.unenrolled,
            { id: props.terminalId, resizeTo: measured, cause },
            {
              label: `terminalAttach[${props.terminalId}]`,
              onRetry: resetIfLive,
            },
          );
        },
        (frame) => {
          if (!attemptLive()) return;
          const statedGrid = frameGrid(frame);
          if (statedGrid) h.resize(statedGrid);
          if (isResizedFrame(frame)) return;
          const ownReset =
            isSnapshotFrame(frame) && frame.data.startsWith(TERMINAL_RESET);
          const addReset = isSnapshotFrame(frame) && repaintOwed && !ownReset;
          if (isSnapshotFrame(frame)) repaintOwed = false;
          const commitSeed = isSnapshotFrame(frame)
            ? backfill?.consumeSnapshotFrame(
                frame.topLine,
                frame.reflowEpoch,
                ownReset || addReset,
              )
            : undefined;
          const body = addReset ? `${TERMINAL_RESET}${frame.data}` : frame.data;
          const data = commitSeed ? `${commitSeed.seam}${body}` : body;
          if (handle()) {
            h.write(data, () => {
              if (!attemptLive()) return;
              h.recovery.noteData();
              commitSeed?.commit();
            });
          }
        },
        resetIfLive,
        `Terminal attach ${props.terminalId}`,
        {
          hasExited: () => {
            const meta = terminalStore.getMetadata(props.terminalId);
            return meta !== undefined && activeArm(meta) === undefined;
          },
        },
      );
      attachFiber = runAction("Terminal attach", consume.pipe(Effect.orDie));
    }

    function closeAttachStream() {
      liveAttempt?.supersede();
      liveAttempt = null;
      attachFiber?.interruptUnsafe();
      attachFiber = null;
      clearTimeout(reassertTimer ?? undefined);
      reassertTimer = null;
    }

    if (props.visible && props.focused !== false) focusOnSelection();

    function writeScratchAndPaste(
      name: string,
      base64: string,
    ): Effect.Effect<void, unknown> {
      return deliverScratchPaste({
        terminalId: props.terminalId,
        name,
        base64,
        scratchWrite: (args) => activePadiRpc.scratch.write(args),
        isActive: () =>
          activeArm(terminalStore.getMetadata(props.terminalId)) !== undefined,
        sendInput: (args) => activePadiRpc.lifecycle.sendInput(args),
        wrapPath: wrapBracketedPaste,
      });
    }

    function uploadFile(
      file: File,
      name: string,
      failed: (message: string) => string,
    ): UiAction {
      return Effect.suspend(() => {
        if (!personInput(props.terminalId)) return Effect.void;
        return Effect.tryPromise(() => file.arrayBuffer()).pipe(
          Effect.flatMap((buf) =>
            writeScratchAndPaste(name, bufferToBase64(buf)),
          ),
          Effect.catch((err) =>
            Effect.sync(() => {
              toast.error(failed(errMsg(err)));
            }),
          ),
        );
      });
    }

    function uploadPastedImage(file: File): UiAction {
      const reason = sizeRejectionFor("clipboard image", file.size);
      if (reason !== null) return Effect.sync(() => toast.error(reason));
      return uploadFile(
        file,
        "image.png",
        (m) => `Failed to upload clipboard image: ${m}`,
      );
    }

    makeEventListener(
      h.container,
      "paste",
      (e: ClipboardEvent) => {
        const items = e.clipboardData?.items;
        if (!items) return;

        const imageItem = Array.from(items).find((i) =>
          i.type.startsWith("image/"),
        );
        const file = imageItem?.getAsFile();
        if (!file) return;

        e.stopPropagation();
        e.preventDefault();
        runAction("upload clipboard image", uploadPastedImage(file));
      },
      { capture: true },
    );

    function uploadDroppedFile(file: File): UiAction {
      const reason = rejectionFor(file.name, file.size);
      if (reason !== null) return Effect.sync(() => toast.error(reason));
      return uploadFile(
        file,
        file.name,
        (m) => `Failed to upload "${file.name}": ${m}`,
      );
    }

    makeEventListener(h.container, "dragover", (e: DragEvent) => {
      if (!e.dataTransfer?.types.includes("Files")) return;
      e.preventDefault();
      e.dataTransfer.dropEffect = "copy";
      (h.container as HTMLElement).dataset.dropTarget = "";
    });
    makeEventListener(h.container, "dragleave", (e: DragEvent) => {
      const next = e.relatedTarget as Node | null;
      if (next && h.container.contains(next)) return;
      delete (h.container as HTMLElement).dataset.dropTarget;
    });
    makeEventListener(h.container, "drop", (e: DragEvent) => {
      const files = e.dataTransfer?.files;
      if (!files || files.length === 0) return;
      e.preventDefault();
      delete (h.container as HTMLElement).dataset.dropTarget;
      for (const file of files) {
        runAction("upload dropped file", uploadDroppedFile(file));
      }
    });
  };

  onCleanup(() => {
    lifecycleCounters.cleanups++;
  });

  createEffect(
    on(
      () => props.visible,
      (visible) => {
        if (!visible) return;
        if (props.focused !== false) focusOnSelection();
      },
      { defer: true },
    ),
  );

  createEffect(
    on(
      () => [props.focused, props.refocusNonce] as const,
      () => {
        queueMicrotask(() => {
          if (props.focused && props.visible) {
            focusOnSelection();
          }
        });
      },
      { defer: true },
    ),
  );

  createEffect(
    on(
      () => props.searchOpen,
      (open) => {
        if (!open && props.visible && props.focused !== false)
          focusOnSelection();
      },
      { defer: true },
    ),
  );

  return (
    <div
      class="w-full h-full relative"
      style={{
        position: props.visible ? "relative" : "absolute",
        inset: "0",
        "content-visibility": props.visible ? "visible" : "hidden",
      }}
      inert={!props.visible}
      {...TERMINAL_SEARCH_ATTR_PROP}
    >
      <Show when={handle()?.addons.search}>
        {(addon) => (
          <SearchBar
            searchAddon={addon()}
            open={props.searchOpen}
            onClose={() => props.onSearchOpenChange(false)}
            onNavigate={() =>
              handle()?.scrollLock.armUserScrollIntent("search")
            }
          />
        )}
      </Show>
      <ScrollToBottom
        visible={handle()?.scrollLock.isLocked() ?? false}
        active={handle()?.scrollLock.hasNewOutput() ?? false}
        onClick={() => {
          const h = handle();
          if (h) h.scrollLock.scrollToBottom(h.terminal);
          focusOnSelection();
        }}
      />
      <Xterm
        theme={props.theme}
        fontSize={fontSize()}
        visible={props.visible}
        boxDecided={props.boxDecided}
        webgl={shouldUseWebgl}
        scrollLockEnabled={() => preferences().scrollLock}
        fullRate={isFocused}
        fontFamily={FONT_FAMILY}
        terminalOptions={{
          scrollback: DEFAULT_SCROLLBACK,
          cursorBlink: true,
          cursorInactiveStyle: "block",
          reflowCursorLine: true,
          // Required by SerializeAddon and ImageAddon for buffer access.
          allowProposedApi: true,
        }}
        onData={(data) => {
          if (isTerminalQueryResponse(data)) return;
          if (!isReadingReport(data) && !personInput(props.terminalId)) return;
          runAction(
            "send input",
            activePadiRpc.lifecycle
              .sendInput({
                id: props.terminalId,
                data: applyStickyModifiers(data),
              })
              .pipe(Effect.ignore),
          );
        }}
        onReady={onReady}
        onTap={onTap}
        webLinkHandler={(event, uri) =>
          handleWebLink(event, uri, props.terminalId)
        }
        webglHooks={{
          onCanvas: (c) => {
            webglTrackerId = trackCreate(props.terminalId, c);
          },
          onBeforeRelease: () => {
            if (webglTrackerId !== null) trackLoseContextCalled(webglTrackerId);
          },
          onDispose: () => {
            if (webglTrackerId !== null) {
              trackDispose(webglTrackerId);
              webglTrackerId = null;
            }
          },
        }}
        class="w-full h-full overflow-hidden touch-manipulation data-[drop-target]:outline data-[drop-target]:outline-2 data-[drop-target]:-outline-offset-2 data-[drop-target]:outline-sky-400/70"
        data-terminal-id={props.terminalId}
        data-visible={props.visible ? "" : undefined}
        data-focused={isFocused() ? "" : undefined}
        data-sub-terminal={props.isSub ? "" : undefined}
        data-font-size={fontSize()}
        data-renderer={(handle()?.webgl.hasWebgl() ?? false) ? "webgl" : "dom"}
      />
      <WorkLock terminal={activeTerminalRef(props.terminalId)} />
      <PrintedUrlCardMount terminalId={props.terminalId} />
    </div>
  );
};

export default Terminal;
