/**
 * Terminal component — kolu's POLICY half over `<Xterm>` (@kolu/xterm-kit/solid).
 *
 * The xterm hazards (owner-correct async construction + disposal, WebGL context
 * lifetime, the scroll lock + its DOM wiring, render recovery, the touch surface)
 * live in `<Xterm>`. This component wires only "which bytes, when, for whom":
 * the attach stream + backfill, keybindings, the PTY, diagnostics, focus policy,
 * paste/drop, and the touch-tap → file-ref decision — all in `onReady`, inside
 * the component's reactive owner so cleanups run.
 *
 * Keyboard zoom is handled by createZoom() (zoom.ts) and consumed here reactively
 * via a fontSize signal, passed to <Xterm> as the fontSize prop.
 */

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
import {
  createAttemptGate,
  createOwnFiber,
  onlyWhenCurrent,
} from "./attachAttempts";
import {
  createFileRefLinkProvider,
  fileRefAtCell,
} from "./fileRefLinkProvider";
import {
  attachRetry,
  type TileAttachInput,
  tileAttachInput,
} from "./attachInput";
import { installTerminalFocusProvenance } from "./focusProvenance";
import {
  createForeignGridWatcher,
  FOREIGN_GRID_SETTLE_MS,
} from "./foreignGrid";
import { handleWebLink } from "./handleWebLink";
import { PrintedUrlCardMount } from "./PrintedUrlCard";
import { deliverScratchPaste } from "./pasteDelivery";
import { trackPrintedPorts } from "./printedPorts";
import { createGridPublisher } from "./publishGrid";
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

/** Module-level counters for the #606 disposal audit. Exposed to window
 *  via `debug/consoleHooks.ts`. `mounts` increments once per component
 *  body execution; `cleanups` increments once per `onCleanup` firing.
 *  If `mounts - cleanups > liveComponentCount` after a mode-toggle run,
 *  some Terminal disposals are being skipped — that's the leak path. */
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

const Terminal: Component<{
  terminalId: TerminalId;
  visible: boolean;
  /** Is the box this pane sits in the one its TILE's layout decided? The tile
   *  states it (`TerminalContent`); the pane only carries it to the kit, which
   *  refuses to measure an undecided box (`XtermOwnProps.boxDecided`). */
  boxDecided: boolean;
  /** Is the VIEW this pane is drawn in the one in front? The shell that places
   *  the tile states it (false while the Conductor covers the workspace). The
   *  pane stays attached and drawing either way; behind the Conductor it
   *  states no size (`shownPane.ts`, `foreignGrid.ts`). */
  viewShown: boolean;
  /** When true, this terminal should grab keyboard focus. */
  focused?: boolean;
  /** Bumped by the host to force a focus re-assert when the reactive `focused`
   *  state can't (e.g. after a sibling sub-tab close steals focus to its close
   *  button without changing this terminal's focus target). */
  refocusNonce?: number;
  theme: ITheme;
  searchOpen: boolean;
  onSearchOpenChange: (open: boolean) => void;
  /** Fired when a user gesture moves focus into this terminal. Programmatic
   *  DOM focus is selection's effect and must not feed back as a command. */
  onFocus?: () => void;
  /** When true, this terminal lives in a sub-panel — it owns its own grid
   *  (its container is independent of the main viewport) and stays out of
   *  the viewport signal. Also used for e2e test selectors. */
  isSub?: boolean;
}> = (props) => {
  lifecycleCounters.mounts++;
  // Policy refs, set in onReady and nulled in onCleanup so this component's
  // closures don't retain the xterm graph after disposal (the #606 leak — the
  // kit disposes the terminal itself; we release only our own references).
  let linkProviderDisposable: { dispose(): void } | null = null;
  let backfill: BackfillController | null = null;
  /** The LIVE attach attempt's fiber — interrupting it ends that attempt's
   *  consume loop and any backoff it is sleeping through. Component-lifetime,
   *  because the teardown below is the component's. */
  let attachFiber: Fiber.Fiber<unknown, never> | null = null;
  /** Component teardown latch. Interruption stops the fiber, but it is
   *  ASYNCHRONOUS, and xterm can still invoke a stashed write callback after the
   *  pane is gone — so "am I torn down" stays a synchronous fact, exactly as the
   *  `signal.aborted` it replaces was. */
  let attachTornDown = false;
  /** The pending {@link REATTACH_BACKOFF_MS} pause of the RE-ASSERT lane — the
   *  fourth reopen lane (kolu#2101 K5). Held so teardown can cancel it, the same
   *  way interrupting `attachFiber` cancels the loop's own sleeping backoff. */
  let reassertTimer: ReturnType<typeof setTimeout> | null = null;
  /** The LIVE attach attempt's RE-ASSERT lane, exposed so the served-grid
   *  watcher below can end this attempt and open one at the grid this pane
   *  actually wants. Its one caller is that watcher.
   *
   *  Each attempt overwrites it on open, and that IS the correctness property
   *  rather than the hazard the attempt-local state warns about: the watcher
   *  must reach whichever attempt is running now, and the closure stored here is
   *  already wrapped in that attempt's own liveness latch, so a stale one is
   *  inert rather than a second successor. */
  let reassertGrid: (() => void) | null = null;
  /** The LIVE attach attempt's own supersession latch, exposed for the one
   *  caller that has to end an attach WITHOUT opening a successor: the pane
   *  going hidden. Every other route out of an attempt is a REPLACEMENT, and a
   *  replacement supersedes by opening (`attempts.open()`); a close has nothing
   *  to open, so it has to reach the latch the attempt guards itself with, or
   *  the attempt would stay "current" and a late frame would paint into a pane
   *  nobody is watching. Same reason `reassertGrid` is held here: the
   *  live attempt's state is in its closure, and a cross-lane caller needs a
   *  door to it. */
  let supersedeAttempt: (() => void) | null = null;
  let disposeDiagnostics: (() => void) | null = null;
  let webglTrackerId: number | null = null;
  const [handle, setHandle] = createSignal<XtermHandle | null>(null);
  const terminalStore = useTerminalStore();

  // Gate zoom on `focused`, not `visible`: a canvas shows many tiles at once,
  // so a `visible` gate let every shown tile's capture-phase zoom listener
  // fire at once — Cmd/Ctrl +/- zoomed all terminals together (#1238).
  // `focused` is true for exactly one tile (the active one in canvas; the
  // single shown one in mobile), so only it zooms.
  // One predicate for "is this the focused tile" — fed to both the zoom gate
  // and the data-focused attribute the e2e harness reads, so the attribute is
  // provably equal to the gate it stands in for (no divergence on `undefined`).
  const isFocused = () => props.focused === true;
  const fontSize = createZoom(props.terminalId, isFocused);

  /** Capability: a terminal may hold a WebGL context only when it's both
   *  rendering (`visible`) and within the WebGL budget — the most-recently-active
   *  tiles that fit under WEBGL_CONTEXT_CAP, each tile costing main pane + active
   *  split (`store.holdsWebgl`; see webglBudget.ts, #1399). Budgeting by recency
   *  rather than the single focused tile keeps WebGL on both sides of an A↔B
   *  switch, so the ~7.7% font reflow on focus swap is gone. Terminals outside
   *  the budget fall back to xterm's built-in DOM renderer. The `visible` guard
   *  keeps a pane nobody is looking at off WebGL regardless of recency —
   *  mobile's one shown tile, a collapsed split, a canvas tile panned out of
   *  view or covered by a maximized one (kolu#2362). Distinct from `isFocused`
   *  (zoom + `data-focused`): a budgeted tile holds WebGL even when it isn't
   *  the focused one. */
  const canUseWebgl = () =>
    props.visible && terminalStore.holdsWebgl(props.terminalId);
  /** Dispatch on user renderer policy:
   *  - `auto`: honor the capability gate (see `canUseWebgl`).
   *  - `webgl`: WebGL on every tile (opt-in; reintroduces #575 risk at scale).
   *  - `dom`: force DOM everywhere (stable font on focus swap, lower GPU). */
  const shouldUseWebgl = () =>
    match(preferences().terminalRenderer)
      .with("auto", canUseWebgl)
      .with("webgl", () => true)
      .with("dom", () => false)
      .exhaustive();

  // Selection-driven focus. Desktop raises the keyboard when a tile becomes
  // active/visible; on touch that's intrusive — the soft keyboard should only
  // rise from an explicit tap (<Xterm>'s tap surface), never as a side-effect of
  // switching/revealing a tile. So this is a no-op on touch. Real taps still
  // call terminal.focus() directly.
  function focusOnSelection() {
    if (isTouch()) return;
    handle()?.terminal?.focus();
  }

  // Open a `path:line` reference in the Code tab. Shared by the hover link
  // provider (desktop mouse click) and the mobile tap handler — both resolve
  // the same ref against this terminal's repo and route through one front door.
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

  // The touch-tap → file-ref decision (policy): resolve the tapped cell through
  // xterm's single pointer→cell authority (cellAtPoint, /internals — the divisor
  // selection/hover share), hit-test the link parser, and follow a hit. Returns
  // true if the tap was consumed (so <Xterm> doesn't summon the soft keyboard).
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

  /** The host entry's state KIND for this pane's host — the same fact that
   *  paints the host pip. A terminal is bound to the ACTIVE host (there is no
   *  host prop; that IS the existing mapping), and `padiMap.entry` is the pure,
   *  owner-free point lens (`wire.ts`). */
  const hostEntryKind = () => padiMap.entry(activeHost()).state().kind;

  /** State this pane's WANTED grid to the server-side PTY. Driven off
   *  `XtermHandle.wantedGrid` — the one door a measured box leaves the kit
   *  through, and a REQUEST rather than a description: the terminal does not
   *  become this size until the host says it did, on the attach stream.
   *
   *  The POLICY (H1's not-connected suppression, K4's latch, the settle window,
   *  and the convergence argument for all three) lives in `publishGrid.ts`; this
   *  binds the facts it reads and the edge a settled publish runs on
   *  ({@link GridPublisherDeps}). A PTY resize makes the shell REPAINT
   *  (SIGWINCH) — but that repaint no longer needs suppressing here: kaval
   *  excludes resize repaints from its meaningful-output edge at the source, so
   *  the live dot (mirrored off padi's `activity` set) never lights on a
   *  reveal/resize in the first place.
   *
   *  ONE publisher per tile, built at component scope so the suppression latch
   *  lives exactly as long as the pane does. */
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

  // Wire kolu's policy over the live terminal. Runs inside <Xterm>'s reactive
  // owner, so every listener / disposable registered here is cleaned up on
  // disposal alongside the terminal the kit owns.
  const onReady = (h: XtermHandle) => {
    onCleanup(registerTerminalElement(props.terminalId, h.container));
    setHandle(h);
    const term = h.terminal;

    // Kolu-owned bridge consumed by e2e step definitions — `support/buffer.ts`,
    // `step_definitions/file_ref_link_steps.ts`, and friends read
    // `container.__xterm` to drive xterm's public API (buffer reads,
    // cell-to-pixel math). Removing this silently breaks every cucumber test
    // that touches terminal contents. Cleared in the teardown below.
    (h.container as HTMLElement & { __xterm?: XTerm }).__xterm = term;

    // Index the loopback URLs this terminal prints, so its Ports section can
    // claim a server that detached from its process subtree (see printedPorts).
    const printedPorts = trackPrintedPorts(term, props.terminalId);

    // Consumer teardown registered HERE, inside onReady — NOT at the component
    // body top. `<Xterm>` is a plain JSX child (no own reactive owner), so a
    // body-registered `onCleanup` lands FIRST on the shared owner and runs LAST
    // under SolidJS LIFO — after the kit's `terminal.dispose()` / webgl-unload,
    // and (since `cleanNode` has no per-entry try/catch) skipped entirely if
    // either throws. Registered from inside `onReady` it lands AFTER the kit's
    // disposal registrations, so LIFO runs it FIRST: the stream aborted, the
    // refs/diagnostics deregistered, backfill disposed, and the `__xterm` #606
    // bridge cleared BEFORE the terminal is disposed — the old single-function
    // order (`Terminal.tsx`'s pre-cut cleanup), restored across the boundary.
    onCleanup(() => {
      attachTornDown = true;
      // The same end the hide takes, in the same order and for the same reason
      // (`closeAttachStream`) — plus the publish the pane still owes nobody.
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
      (h.container as HTMLElement & { __xterm?: XTerm }).__xterm = undefined;
      setHandle(null);
    });

    // Linkify `path:line[:col][-end]` references in terminal output. The link
    // provider reads repoRoot from the terminal store at click time (not at
    // mount) so a cwd change keeps subsequent clicks anchored to the new repo.
    linkProviderDisposable = term.registerLinkProvider(
      createFileRefLinkProvider(term, { onActivate: activateFileRef }),
    );
    term.loadAddon(new ClipboardAddon(undefined, new SafeClipboardProvider()));

    // Production path for handlers that need live xterm/addon refs (e.g.
    // export-as-PDF reads the serialize addon; diagnostics read the probes).
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
    // Diagnostics subscribes to hasWebgl via accessor — keeps it the single
    // source of truth, no imperative updater to forget.
    disposeDiagnostics = registerDiagnostics(props.terminalId, {
      renderer: () => (h.webgl.hasWebgl() ? "webgl" : "dom"),
      // Both grids, from the kit's own two signals — the size the terminal IS
      // and the size this pane's box WANTS. They differ for a settle window
      // plus a round trip after any box change, so a dialog showing one of them
      // cannot explain a terminal that looks a row short; and `wanted` being
      // null is also "this pane has never measured, so no attach stream has
      // opened" — a state that looks exactly like attached-and-quiet on screen.
      term: h.termGrid,
      wanted: h.wantedGrid,
      scrollLock: {
        locked: h.scrollLock.isLocked,
        pendingChunks: h.scrollLock.pendingChunks,
        lastEvent: h.scrollLock.lastEvent,
      },
    });

    // xterm.js has attachCustomKeyEventHandler for intercepting keys.
    // Return false to prevent xterm from handling the key.
    term.attachCustomKeyEventHandler((e: KeyboardEvent) => {
      // Let Cmd+key pass through to browser (except copy/paste without Shift)
      if (e.metaKey) {
        const key = e.key.toLowerCase();
        if ((key === "c" || key === "v") && !e.shiftKey) return true;
        return false;
      }

      // Let browser handle Ctrl+V so it fires a paste event. Our capture-phase
      // paste listener uploads images; xterm's own paste handler covers text.
      if (e.ctrlKey && e.key === "v") return false;

      // Ctrl+Shift+C — Linux/Windows terminal copy chord. Without preventDefault,
      // Chromium hijacks the chord to open DevTools' Inspect Element picker.
      // xterm's selection isn't reflected in the textarea either, so we copy via
      // getSelection() ourselves. Must come before the matchesAnyShortcut check
      // below, since copySelection is registered there for ShortcutsHelp
      // visibility but dispatched here.
      if (matchesKeybind(e, ACTIONS.copySelection.keybind)) {
        e.preventDefault();
        const selection = term.getSelection();
        if (selection)
          // Forked SYNCHRONOUSLY inside the keystroke's gesture window — the
          // execCommand leg of `writeTextToClipboard` needs an active user
          // activation, and `runAction` runs on this stack until the effect
          // first suspends.
          runAction(
            "copy selection",
            writeTextToClipboard(selection).pipe(
              Effect.tap(() =>
                Effect.sync(() =>
                  toast.success("Copied selection to clipboard"),
                ),
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
      }

      // Let any registered app shortcut bubble through to the capture-phase dispatcher
      if (matchesAnyShortcut(e)) return false;

      return true;
    });

    if (term.textarea) {
      // xterm may stop gesture events inside its own subtree. Capture them at
      // the mount boundary and arm one document-wide provenance token: Tab can
      // move focus into a sibling terminal, while a pointer focus lands here.
      // The first resulting focus consumes the token; mount/refocus/dialog
      // `.focus()` calls have no token and can never echo into selection.
      onCleanup(
        installTerminalFocusProvenance({
          pane: h.container,
          textarea: term.textarea,
          isFocused: () => props.focused === true,
          onFocus: () => props.onFocus?.(),
        }),
      );
    }

    // On tab re-show, re-fit, clear the atlas, flush a lock engaged while hidden
    // (#1272), and force a sync repaint of a possibly parked-rAF frame.
    refitOnTabVisible(
      () => {
        h.refit();
        h.webgl.clearTextureAtlas();
        h.scrollLock.handleTabVisible();
        h.recovery.recover();
      },
      () => props.visible,
    );

    // Scrollback backfill: attach paints only the recent screenful; as the user
    // scrolls up, fetch older chunks from kaval and prepend them into this
    // terminal's own scrollback. Seeded from the attach snapshot's `topLine`
    // (below); self-manages the near-top trigger and the reset/resize races.
    backfill = createBackfillController(term, {
      // `@kolu/xterm-kit`'s `fetch` seam is Promise-shaped by contract (the kit
      // is deliberately outside Effect), so this is a run edge — through the
      // package's one named bridge, which rejects with the SQUASHED failure so
      // the `_tag` narrowing in `isTerminalGone` below stays honest.
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
      // The killed-terminal teardown, recognised HERE because the error class is
      // kolu's, not the kit's: padi declares `TerminalNotFound` on
      // `screen.history`, and the kit asks this predicate about a `fetch`
      // rejection only. Matched on the `_tag` (see `rpc/declaredErrors`) so a
      // wire hop cannot cost us the recognition.
      isTerminalGone: (err) => isDeclared(err, TERMINAL_NOT_FOUND),
      // A splice fires no write; the printed-port index must be told.
      onPrepended: () => printedPorts.notePrepended(),
      // Any OTHER backfill fetch fault (transport, schema, server) surfaces here
      // rather than silently leaving a scrollback hole. A later scroll retries.
      onError: (err) =>
        toast.error(
          `Failed to load older scrollback: ${err instanceof Error ? err.message : String(err)}`,
        ),
    });

    // The attach stream's FIRST yield is a serialized screen snapshot
    // (scrollback), not live output — see `terminal.attach` in router.ts. The
    // snapshot is still WRITTEN to xterm; live-dot activity no longer rides this
    // attach sink (it mirrors padi's activity set off the wire — see
    // `attention/useAttentionFacts`), so the client no longer needs a snapshot-vs-delta
    // boundary here: the backfill controller keys off the frame's own
    // `kind === "snapshot"` discriminator below.
    // Make the pane ready for the NEXT stream's first frame (a fresh snapshot),
    // so it replaces stale bytes without double-painting. Used by the inner
    // `onRetry` (a transparent STREAM_RETRY re-subscribe on a transport blip),
    // the outer re-attach (a mid-chain padi death STREAM_RETRY won't retry —
    // done-criterion (c)), and the reveal.
    //
    // TWO halves, because the reveal may use only one of them. CLEARING is the
    // half nobody can see: the write pipeline, the scroll lock and the backfill
    // cursor, all of which describe bytes that are about to be superseded.
    const clearForFreshSnapshot = () => {
      // Drop write-pipeline pending (coalesce + scroll-lock) WITHOUT writing —
      // a flush would re-paint pre-reset chunks onto the snapshot that replaces
      // them. First, because `terminal.reset()` clears the screen buffer only:
      // a chunk already queued in xterm parses after it (`internals.ts`).
      h.clearPendingOutput();
      h.scrollLock.reset("drop");
      // Forget the backfill cursor: the next frame is a fresh snapshot that
      // re-seeds it (below). Fetching against the old cursor would splice onto
      // a buffer the snapshot has since replaced.
      backfill?.reset();
    };
    // …and BLANKING, which is visible, and therefore only for the ends that
    // have NO snapshot in hand: a transport re-subscribe (`onRetry`) and a
    // stale-grid reopen, both of which are getting rid of bytes the pane must
    // stop looking at, with the replacement a round trip away. A reveal is not
    // one of those — it blanks nothing, and its snapshot carries its own reset
    // instead (the open's `repaint`).
    const resetForFreshSnapshot = () => {
      clearForFreshSnapshot();
      handle()?.terminal?.reset();
    };
    // The attach stream may open only while this pane is SHOWN — measured AND
    // visible — and it ENDS the moment the pane stops being either.
    //
    // The JUDGMENT — why each half is required, and why a hidden pane's
    // measurement is not lost — is `shownPane.ts`'s; what stays here is the two
    // live facts and the acts they drive. MEASURED is `h.wantedGrid()`, the
    // kit's one door for a real measurement of this pane's box (an unmeasured
    // xterm reports the 80×24 its constructor invents); VISIBLE is the tile's
    // own `visible` prop, which a mobile body hidden with `content-visibility`
    // still has a measurable box under.
    const shown = () => h.wantedGrid() !== null && props.visible;
    // IN FRONT is the shell's other fact: whether the view this pane is drawn
    // in is the one being looked at (false while the Conductor covers the
    // workspace). It does not touch the attach — the pane keeps drawing — only
    // whether it states a size (`shownPane.ts`).
    const viewShown = () => props.viewShown;
    const shownPane = createShownPane({
      shown,
      viewShown,
      attach: () => {
        // Everything the pane still holds from the attach its last hide ended
        // has to go — but the SCREEN is not cleared, because the snapshot this
        // open is answered with carries its own reset (`repaint` below).
        clearForFreshSnapshot();
        openAttachStream({ cause: "attach", repaint: true });
      },
      detach: closeAttachStream,
      publish: gridPublisher.publish,
      cancelPublish: gridPublisher.cancel,
      // The OTHER thing that can owe the PTY a size: a grid change that
      // happened while this pane's host was not connected (kolu#2101 K4). The
      // grid effect below fires per GRID CHANGE, so nothing re-observes the host
      // coming back — and if the open attach stays silent through the outage
      // there is no re-attach to restate it either, leaving the PTY at its old
      // size with no symptom but wrong output. So the gate is re-observed on the
      // host's state too (below), and leans on the latch for idempotence: with
      // nothing owed it does nothing, and a restatement that lands clears the
      // latch. Reachable on the LOCAL host too — `daemon.restart` drains it out
      // of `connected`. No settle window: the latched grid is a measurement that
      // stopped moving an outage ago. Behind the Conductor it stays owed.
      restateOwed: gridPublisher.republishSuppressed,
    });
    createEffect(
      on([shown, viewShown, hostEntryKind], () => shownPane.observe()),
    );

    // The ONE publisher of this pane's WANTED grid → the PTY. (The attach's own
    // `resizeTo` states the grid the pane OPENS at; every change after that
    // travels here — and a change measured while the pane is hidden travels
    // nowhere, because the attach the reveal opens restates it.) `wantedGrid` is
    // value-compared inside the kit, so this fires exactly once per REAL
    // measurement change — the initial fit included — and never for a re-fit
    // that measured nothing new.
    // Driving it from the signal rather than a second `onResize` callback door
    // means "who states this pane's size" has a single answer.
    createEffect(
      on(h.wantedGrid, (measured) => {
        if (measured) shownPane.measured(measured);
      }),
    );

    // The pty's OWN grid, as the record states it — the standing fact that says
    // this pane is not getting the size it ASKED for, and its route back to one
    // it wants. The WHY and the judgment (a settle window, and the one mismatch
    // to sit out) are `foreignGrid.ts`'s; what stays here is the live facts it
    // binds and the re-attach.
    const foreignGrid = createForeignGridWatcher({
      served: () =>
        activeArm(terminalStore.getMetadata(props.terminalId))?.grid,
      // The grid this pane WANTS, never the one its terminal currently has: the
      // terminal follows the pty by design now, so comparing the two served
      // facts would always agree and the watcher would never fire. Absent while
      // the view is behind the Conductor: a pane that states no size has none
      // to compare.
      mine: () => (viewShown() ? h.wantedGrid() : null),
      hostState: hostEntryKind,
      reopen: () => reassertGrid?.(),
      settleMs: FOREIGN_GRID_SETTLE_MS,
    });
    onCleanup(() => foreignGrid.dispose());
    createEffect(
      on(
        [
          () => activeArm(terminalStore.getMetadata(props.terminalId))?.grid,
          viewShown,
        ],
        () => foreignGrid.observe(),
      ),
    );

    // Supersession for restartable attach loops: every attempt holds its OWN
    // state in its closure and asks the gate whether it is still the live one.
    // See `attachAttempts.ts`.
    const attempts = createAttemptGate();

    /** WHY an attach opens — the one fact the lanes differ by, carried as an
     *  argument of the open rather than as a mark left on the pane for the next
     *  one to find. Each lane names both halves at the call site: a reveal owes
     *  its first snapshot a repaint (the hide deliberately left the old screen
     *  standing), the foreign-grid watcher's reopen is `"foreign"` on the wire
     *  so the host can count attaches a user never asked for, and every other
     *  reopen is an ordinary `"attach"` that blanked the screen itself. */
    type OpenReason = { cause: AttachCause; repaint: boolean };

    // Carve-out (Leak A): `terminalAttach` is a padi SURFACE stream member
    // (`padiSurface.streams.terminalAttach`), but its health is the terminal's
    // OWN concern — surfaced in-pane (a reset + visible retry on `onRetry`, the
    // snapshot re-armed), not folded into padi's fleet/host `health()` gate. A
    // single terminal's re-attach (overflow re-attach #1591, PTY exit) must never
    // flicker the global connection-health indicator. So it deliberately uses
    // `unenrolledStreamCall` (`@kolu/surface/client`) — the bare, un-enrolled
    // call — rather than `padi.rawStream`'s structural health enrolment, and the
    // `unenrolled-` name makes that a visible decision at the call site.
    //
    // The carve-out STAYS after kolu#2101, and it is not what let the frozen
    // panes go unreported: it decides which indicator a re-attach lights (the
    // GLOBAL connection dot — not this one), never whether a dead attach is
    // noticed at all. That fact is this loop's own, and it now has a verdict —
    // an unexpected clean end re-attaches and, if the chain keeps manufacturing
    // ends, dies through the run edge (console + toast). Enrolling here instead
    // would flicker the fleet's health on every ordinary overflow re-attach and
    // still not answer "is THIS pane alive".
    function openAttachStream(why: OpenReason) {
      // ALL of this attempt's state lives here, in its closure — never in a
      // binding a successor could overwrite. `attempt` decides whether this
      // loop's work still counts; `superseded` is this attempt's own teardown
      // latch, set BEFORE its fiber is interrupted.
      const attempt = attempts.open();
      let superseded = false;
      /** THIS attempt's fiber — never the shared `attachFiber`, which a
       *  successor may already hold, and interruptible before the fork has
       *  returned it (`attachAttempts.ts`). */
      const ownFiber = createOwnFiber();
      /** The reason, spent. Both halves are ONE-SHOT and the shot is this
       *  attempt's FIRST: the repaint is owed to the first snapshot frame, and
       *  the cause describes the open, so the loop's own re-subscribe after a
       *  transport blip reports the ordinary one. */
      let repaintOwed = why.repaint;
      let causeOwed: AttachCause | null = why.cause;

      /** Live = still the current attempt AND not torn down. `isCurrent()` alone
       *  stays true forever when no successor opens, so an unmounted pane's
       *  scroll-lock-stashed callback would still act.
       *
       *  Both latches are SYNCHRONOUS, and they must be: fiber interruption
       *  stops the loop but is asynchronous, so a frame or a stashed xterm write
       *  callback already past its last suspension can still arrive. Stopping
       *  the work and refusing a stale result are two jobs — the same law
       *  `attachAttempts.ts` states for the generation gate. */
      const attemptLive = () =>
        attempt.isCurrent() && !superseded && !attachTornDown;

      // Every effect this attempt can still fire after supersession, guarded in
      // one place — keyed on the LIVE predicate, so it is inert after unmount
      // too. The reset hooks matter most: an old loop resetting the screen would
      // wipe the successor's authoritative snapshot.
      const resetIfLive = onlyWhenCurrent(
        { isCurrent: attemptLive },
        resetForFreshSnapshot,
      );

      /** End this loop and start exactly one replacement, built from the pane
       *  as it is NOW — the FOURTH reopen lane, named in `reattachingStream.ts`'s
       *  module-header taxonomy along with the other three (kolu#2101 K5).
       *
       *  Two callers, both about a size rather than a failure:
       *   - the served-grid watcher (`"foreign"`): the pty is sitting at a size
       *     this pane did not ask for and has stayed there past the settle, so
       *     re-attaching is how the pane asks again (`resizeTo` is
       *     last-attach-wins — the attach IS the assertion);
       *   - a transport retry behind the Conductor (`"attach"`): the fence would
       *     replay this attempt's captured `resizeTo`, and a tile behind the
       *     Conductor states no size (`attachInput.ts`), so it reopens instead
       *     and the successor asks for nothing.
       *  Neither can go through the loop's own error channel because nothing
       *  failed that a replay would repair: what is wrong is a size.
       *
       *  What it takes instead is the loop's DISCIPLINE: the same
       *  {@link REATTACH_BACKOFF_MS} pause, in the same order the loop uses
       *  (reset now, re-subscribe after the pause), rather than reopening
       *  instantly and letting one lane jump the queue. Its episode accounting
       *  needs no special case: a delivered frame refills both budgets.
       *
       *  Guarded by `attemptLive()` at every call site, so several superseded
       *  callbacks reaching here produce ONE successor, not a cascade. */
      const endAndReopen = (cause: AttachCause) => {
        // Latch first, interrupt second — the window between them is exactly
        // where a late frame of this attempt would otherwise land.
        //
        // The interrupt is this attempt's OWN fiber's. From the fence's retry
        // hook the fiber is the one running the hook; the runtime applies the
        // interrupt at the next step of its run loop, before the retry's
        // pause, so the replay never goes out. And should a drop ever fail the
        // first subscribe in the same turn as the fork, before the handle
        // exists, the interrupt is owed and applied when the fork returns —
        // while the fence sits in that pause.
        //
        // BETA-ASSUMPTION(4.1.4): an interrupt issued from inside the fence's onRetry hook stops the stream before the retry's re-subscribe.
        // Measured by packages/client/src/terminal/ownFiber.test.ts with the
        // real `unenrolledStreamCall`: one subscribe, not two.
        superseded = true;
        ownFiber.interrupt();
        resetForFreshSnapshot();
        // The pause is a timer rather than a sleeping fiber because there is no
        // fiber left to sleep in — this attempt's was just interrupted. It is
        // cancelled by the component teardown, which is the same lifetime the
        // interrupt above respects.
        clearTimeout(reassertTimer ?? undefined);
        reassertTimer = setTimeout(() => {
          reassertTimer = null;
          if (attachTornDown) return;
          openAttachStream({ cause, repaint: false });
        }, REATTACH_BACKOFF_MS);
      };
      /** The input the fence will replay on a transport retry — the one the
       *  current subscribe of THIS attempt was opened with. */
      let sent: TileAttachInput | null = null;
      /** The fence's retry hook: replay as always (clearing the screen for the
       *  fresh snapshot the replay brings), or — behind the Conductor, with a
       *  size captured — end this attempt and reopen asking for nothing. */
      const onRetry = onlyWhenCurrent({ isCurrent: attemptLive }, () => {
        if (sent && attachRetry(sent, viewShown()) === "reopen")
          endAndReopen("attach");
        else resetForFreshSnapshot();
      });

      // The served-grid watcher's route into THIS attempt (see the binding's
      // note). Guarded exactly as every other cross-lane callback is, so a
      // watcher tick that lands on a superseded attempt does nothing.
      // `"foreign"` is the watcher lane's only cause: an attach that exists
      // because another viewer took the terminal is not the same event as a
      // user revealing a pane, and the host can only tell them apart if the
      // client says which it is.
      reassertGrid = onlyWhenCurrent({ isCurrent: attemptLive }, () =>
        endAndReopen("foreign"),
      );

      // The hide route into THIS attempt (see the binding's note). A close is
      // the one end that opens no successor, so it has to set the attempt's own
      // latch: `attempts.open()` is what supersedes everywhere else, and there
      // is no open here to do it.
      supersedeAttempt = () => {
        superseded = true;
      };

      const consume = consumeReattachingStream(
        () => {
          // The grid this pane WANTS, read at the moment the stream opens,
          // and the input built from it (`attachInput.ts`, which says what an
          // attach may carry and what a transport retry may replay). Nothing
          // downstream compares a frame against it: what comes back states
          // its OWN grid and the pane follows that.
          //
          // This thunk is NOT the transport-retry path: the fence re-subscribes
          // by replaying the input captured here (`dev/skills/streaming/
          // SKILL.md`, "A member's input is CAPTURED"), while
          // `consumeReattachingStream`'s own outer re-attach DOES re-enter it
          // and picks up a fresh one. In front, a replayed stale grid is
          // repaired by the served-grid watcher, the lane a foreign viewer's
          // resize takes; behind the Conductor `onRetry` reopens instead.
          //
          // Absent is unreachable — the shown-pane gate opens the stream only
          // once a measurement exists, and a measured box is never un-measured.
          //
          // So a throw here is a DEFECT (channel 1 in `reattachingStream`'s
          // header) and that is what makes it fail loud: the re-attach loop
          // retries FAILURES, so a defect is not retried — it reaches the run
          // edge, which reports it (console + toast) and ends the attach.
          // Retrying it would instead run `resetForFreshSnapshot` every 300ms,
          // blanking the user's pane three times a second. This is the ONE throw
          // on the attach path that means it: the unreachable-by-construction
          // breach, with no repair to attempt.
          const measured = h.wantedGrid();
          if (!measured) {
            throw new Error(
              `terminal ${props.terminalId}: attach opened without a measured grid`,
            );
          }
          // The reason this attempt opened, spent as it is sent: the loop's
          // own re-attach re-enters this thunk, and that open is an ordinary
          // one rather than a second foreign one. (A transport retry does NOT
          // re-enter it — see above — it replays this input, cause and all.)
          const cause = causeOwed ?? "attach";
          causeOwed = null;
          sent = tileAttachInput({
            id: props.terminalId,
            cause,
            wanted: measured,
            viewShown: viewShown(),
          });
          return unenrolledStreamCall(
            activePadiStreams.terminalAttach.unenrolled,
            sent,
            {
              // Names the PANE, in the framework's `<key>[<id>]` spelling and
              // with the same terminal id the attach loop's log lines carry — a
              // canvas of panes attaches the same member N times, and a
              // liveness table that could not tell them apart would name none
              // of them (kolu#2101 J2).
              label: `terminalAttach[${props.terminalId}]`,
              // The attempt's lifetime IS its fiber — interrupting it tears the
              // subscription down through the stream's own finalizers, so there
              // is no signal to thread into the call (D10/#18). The hook stays
              // guarded for the same reason as before: a superseded attempt's
              // retry must not wipe the successor's screen, or reopen past it.
              onRetry,
            },
          );
        },
        (frame) => {
          // A superseded loop delivers NOTHING. Its abort has fired but the
          // iterator settles later, so frames already queued behind it still
          // arrive here — and consuming one would paint into a terminal the
          // successor has already reset.
          if (!attemptLive()) return;
          // THE STREAM OWNS THIS TERMINAL'S SIZE (`@kolu/padi-client/attach`,
          // rule 1, which is where the argument lives). Two frames state a
          // size and the pane obeys both, HERE, in the order they arrived:
          //
          //   · a `resized` — the pty's mirror changed size at this exact point
          //     between two bytes. Nothing else happens: no bytes, no backfill
          //     seed, no repaint debt spent. `h.resize` walks it through the
          //     same write door the bytes take, so it lands behind everything
          //     the unfocused coalescer or an engaged scroll lock is holding
          //     and ahead of everything that follows.
          //   · a `snapshot` — bytes already laid out for the frame's own grid.
          //     The terminal is set to that grid FIRST and painted SECOND, so a
          //     screen is never parsed at a width it was not serialized for.
          //
          // ONE reading for both arms (`frameGrid`), so covering `snapshot`
          // while forgetting `resized` is not spellable here. There is no
          // refusal arm: `reattachingStream.ts` keeps the obituary of the one
          // that used to be here.
          const statedGrid = frameGrid(frame);
          if (statedGrid) h.resize(statedGrid);
          if (isResizedFrame(frame)) return;
          // A `snapshot` frame begins a fresh snapshot (initial attach or a
          // MID-STREAM overflow re-attach). Consume it as one indivisible act:
          // `consumeSnapshotFrame` INVALIDATES the backfill controller synchronously
          // RIGHT HERE — before the bytes are written or scroll-lock-buffered — so
          // an in-flight fetch's continuation can't splice across the RIS this frame
          // carries onto the reset buffer. It returns a committer that SEEDS only
          // once the snapshot has PARSED into the buffer (run from the write callback
          // below): parsing a ~1000-line snapshot itself emits `onScroll` as `ydisp`
          // climbs from 0 through the near-top trigger band, and a cursor seeded up
          // front would let one of those fire an unsolicited fetch onto a
          // still-parsing buffer. Once parsed, the viewport sits at the BOTTOM, so no
          // fetch fires until a real user scroll-up. The committer rides the write
          // callback, which scroll-lock preserves across a buffered flush — so the
          // seed can't be lost while the user is scrolled up.
          //
          // Two things can make this frame a REPAINT rather than a paint. padi's
          // overflow re-attach already sends `TERMINAL_RESET + snapshot` as one
          // frame; a REVEAL-opened attach owes its first snapshot the same shape,
          // because the hide deliberately left the old screen standing so that
          // this frame could replace it in a single write instead of the pane
          // going blank for the round trip. A pane's FIRST attach takes the same
          // road, onto an empty terminal where a RIS paints nothing — one rule
          // instead of two. The debt is spent HERE, past the refusal above: a
          // snapshot that is never painted leaves it standing for the frame that
          // is.
          const ownReset =
            isSnapshotFrame(frame) && frame.data.startsWith(TERMINAL_RESET);
          const addReset = isSnapshotFrame(frame) && repaintOwed && !ownReset;
          if (isSnapshotFrame(frame)) repaintOwed = false;
          const commitSeed = isSnapshotFrame(frame)
            ? backfill?.consumeSnapshotFrame(
                frame.topLine,
                frame.reflowEpoch,
                // The controller's esc handler pauses on THIS frame's own leading
                // RIS too, so the controller must know one is coming — whether the
                // host sent it or the reveal prepended it below: the seam captures
                // the committer's baseline one generation-bump BEFORE that RIS and
                // PREDICTS it, so the frame's own reset doesn't read as an
                // invalidation that revokes this frame's re-seed — otherwise
                // backfill pauses forever after a re-attach (F11).
                ownReset || addReset,
              )
            : undefined;
          // A consumed snapshot frame carries its OWN seed seam (with a per-frame
          // token) so the controller captures its committer baseline at the
          // snapshot's byte position, not at receipt — the F11 fix under scroll
          // lock, where a foreign RIS buffered ahead of this snapshot would
          // otherwise steal its seed. The controller mints the seam bytes
          // (`commitSeed.seam`); prepended ONLY when a controller actually consumed
          // the frame, so the seam and the controller's pending-seed FIFO stay 1:1.
          // The seam stays AHEAD of the reveal's RIS for exactly the reason the
          // prediction above works: it must parse one bump before the reset it
          // predicts, never after it.
          const body = addReset ? `${TERMINAL_RESET}${frame.data}` : frame.data;
          const data = commitSeed ? `${commitSeed.seam}${body}` : body;
          if (handle()) {
            // The live-activity dot is no longer lit from this attach sink — it
            // mirrors padi's `activity` set (kaval's resize-excluded edge) off the
            // wire, so it works for background terminals and never flashes on a
            // reveal/resize repaint. See `attention/useAttentionFacts`.
            // Key the render-stall watchdog to xterm's PARSE, not stream receipt:
            // `term.write` returns immediately and parses the chunk asynchronously
            // (off a setTimeout), so noteData() run here synchronously would arm a
            // 250ms timer against data not yet in the buffer. Passing noteData as
            // xterm's write callback arms it when the chunk has actually landed in
            // the buffer and a paint should follow. scroll-lock buffers a chunk ->
            // no paint -> the callback isn't invoked NOW; it is stashed WITH the
            // chunk, and flush() fires every buffered chunk's callback once the
            // buffered write parses on unlock — so the snapshot re-seed committer
            // that rides this callback survives the lock instead of being dropped.
            // Single kit write door (coalesce → scroll-lock → term); fullRate is
            // the focused-tile policy on <Xterm>.
            h.write(data, () => {
              // A superseded (or unmounted) attempt's stashed callback does
              // NOTHING: it would report activity for a stream nobody is reading
              // (arming the render-stall watchdog against the successor's paint),
              // commit a seed belonging to a dead attempt, or restart the loop a
              // second time. The guard is FIRST, ahead of `noteData`, so none of
              // those effects can precede it.
              if (!attemptLive()) return;
              h.recovery.noteData();
              // There is no second grid check here any more, and that is the
              // point of the change: a snapshot's bytes are parsed into a
              // terminal already set to the grid they were laid out at, and the
              // resize that follows them arrives as its own frame BEHIND this
              // chunk in the same door. So "did the pane move while these bytes
              // were in flight" can no longer make the seed wrong — the buffer
              // these bytes landed in is the one they describe, whenever scroll
              // lock chooses to let them in.
              // Seed the backfill cursor now that this snapshot has landed in the
              // buffer (see the note above the write) — undefined, hence a no-op,
              // for a plain delta frame, which carries no `topLine`.
              commitSeed?.commit();
            });
          }
        },
        resetIfLive,
        // Names the PANE, not just the surface: this label prefixes every line
        // the loop logs AND keys the verdict's toast id, so an un-labelled one
        // would collapse a canvas of separately-wedged panes into a single
        // message naming none of them (kolu#2101 K1/K3-client).
        `Terminal attach ${props.terminalId}`,
        {
          // The tile's OWN exit fact, for classifying a CLEAN stream end
          // (kolu#2101): a clean end is a real PTY exit only if this tile knows
          // the PTY is gone — otherwise it is a manufactured end and the loop
          // re-attaches once instead of waiting forever for an exit event that
          // is never coming.
          //
          // `activeArm` is the same local liveness fact the resize toast and the
          // scratch paste already read (the metadata arm, `state === "active"`),
          // reused rather than re-derived. RESOLVED metadata that is not active
          // is the positive "it exited" answer; ABSENT metadata is UNKNOWN and
          // deliberately reads as still-live — a wrong "live" costs one attach
          // RPC that padi answers `TerminalNotFound` (which ends the loop), a
          // wrong "exited" costs the blank pane this change exists to kill.
          hasExited: () => {
            const meta = terminalStore.getMetadata(props.terminalId);
            return meta !== undefined && activeArm(meta) === undefined;
          },
        },
      );
      // One fiber per attempt. Interrupting it ends this consumer AND any
      // backoff it is sleeping through, so a superseded attempt cannot keep
      // re-subscribing on the successor's behalf — what the per-attempt
      // `AbortController` fused with `AbortSignal.any` used to buy, minus the
      // fusing. `orDie`: the retry schedule is infinite, so a failure reaching
      // here is unreachable by construction and says so loudly rather than
      // silently ending the attach.
      attachFiber = runAction("Terminal attach", consume.pipe(Effect.orDie));
      ownFiber.set(attachFiber);
    }

    /** End the live attach and open NOTHING — the pane stopped being shown.
     *
     *  The ONE teardown with no successor, which is what makes it its own
     *  function rather than a call to an existing lane: every other end here is
     *  a replacement, and a replacement supersedes by opening. This has to do by
     *  hand what `attempts.open()` does for them, in the SAME order the component
     *  teardown uses — latch first, interrupt second, cancel the pending reopen
     *  last — because the window between the latch and the (asynchronous)
     *  interrupt is exactly where a late frame or a stashed xterm write callback
     *  of the dying attempt would otherwise land, and the pending
     *  {@link REATTACH_BACKOFF_MS} timer would resurrect the loop a third of a
     *  second after the pane went dark.
     *
     *  The screen is left alone: hiding a pane must not blank it, and revealing
     *  it must not either — the stale bytes stay where nobody is looking at
     *  them until the reveal's own snapshot arrives and replaces them in one
     *  write.
     *
     *  The pane's PENDING PUBLISH goes, though, and it goes through the gate
     *  (`shownPane.ts`), which owns what hiding costs. */
    function closeAttachStream() {
      supersedeAttempt?.();
      supersedeAttempt = null;
      reassertGrid = null;
      attachFiber?.interruptUnsafe();
      attachFiber = null;
      clearTimeout(reassertTimer ?? undefined);
      reassertTimer = null;
    }

    // Initial focus, mirroring the old post-fit focus on first mount.
    if (props.visible && props.focused !== false) focusOnSelection();

    // Bridge browser clipboard images → PTY. Capture phase fires before xterm's
    // own paste handler on the textarea, letting us intercept images while text
    // paste falls through to xterm. Uses the native paste event (not
    // navigator.clipboard.read) so no explicit clipboard-read permission is
    // needed. Write decoded bytes into the terminal's on-disk scratch dir, then
    // bracketed-paste the returned path into the PTY. `sendInput` quiet-drops on
    // a terminal that is no longer active, so `deliverScratchPaste` re-checks
    // liveness between the write and the send and throws otherwise — the caller's
    // catch turns that into a toast.error instead of a silent drop.
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

    /** Read a dropped/pasted file and deliver it — the shared body behind the
     *  two upload paths, which differ only in their size rule and their toast. */
    function uploadFile(
      file: File,
      name: string,
      failed: (message: string) => string,
    ): UiAction {
      return Effect.suspend(() => {
        // THE LOCK, at the one place both upload paths (clipboard image and
        // drop) deliver through: pasting a file into a terminal the Conductor
        // drives is a person typing a path into it, so it is gated exactly
        // like a keystroke and nudges rather than quietly writing a scratch
        // file nothing will ever paste.
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
        if (!file) return; // No image — let xterm handle text paste

        // Must stop propagation synchronously before the async upload, otherwise
        // xterm's paste handler would paste the image as garbled text.
        e.stopPropagation();
        e.preventDefault();
        runAction("upload clipboard image", uploadPastedImage(file));
      },
      { capture: true },
    );

    // Drag-and-drop file upload. Files dropped on the terminal are uploaded to
    // the server, which saves them under the terminal's clipboard directory and
    // bracketed-pastes the path into the PTY — the same shape as Ctrl+V image
    // paste, just sourced from DataTransfer instead of ClipboardData.
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
      // Only react when the drag carries files — text/HTML drags belong to the
      // browser / xterm.
      if (!e.dataTransfer?.types.includes("Files")) return;
      e.preventDefault();
      e.dataTransfer.dropEffect = "copy";
      (h.container as HTMLElement).dataset.dropTarget = "";
    });
    makeEventListener(h.container, "dragleave", (e: DragEvent) => {
      // dragleave fires when the cursor crosses any child element boundary too;
      // gate on relatedTarget leaving the container so the highlight doesn't
      // flicker mid-drag.
      const next = e.relatedTarget as Node | null;
      if (next && h.container.contains(next)) return;
      delete (h.container as HTMLElement).dataset.dropTarget;
    });
    makeEventListener(h.container, "drop", (e: DragEvent) => {
      const files = e.dataTransfer?.files;
      if (!files || files.length === 0) return;
      // Prevent browser navigation (default action when dropping a file onto a
      // page). Must come after the guard: only cancel drops we actually handle so
      // text/HTML drags fall through unimpeded.
      e.preventDefault();
      delete (h.container as HTMLElement).dataset.dropTarget;
      for (const file of files) {
        runAction("upload dropped file", uploadDroppedFile(file));
      }
    });
  };

  // The #606 mount/cleanup audit counter, registered in the body so it fires
  // even if the owner is disposed during <Xterm>'s font await (before onReady
  // ran — in which case there is nothing to tear down). The consumer teardown
  // that must run BEFORE the kit disposes the terminal lives in an onCleanup
  // inside onReady (see there), so SolidJS LIFO orders it before the kit's
  // terminal.dispose() rather than after it.
  onCleanup(() => {
    lifecycleCounters.cleanups++;
  });

  // Auto-focus when this terminal becomes visible (display:none → visible) — only
  // if it should have focus. The re-fit / scroll-to-bottom on visible is owned by
  // <Xterm>; this is the focus half. defer: true — onReady handles first focus.
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

  // Restore focus from two trigger sources, one guard. The `focused` prop
  // transitioning to true (e.g. a sub-panel toggle) grabs focus; and the host
  // bumping `refocusNonce` re-fires this effect WITHOUT a `focused` transition.
  // The re-grab still requires `props.focused` (only the focus-owning pane
  // responds) — it's the *edge-less re-fire* that's new: a sibling sub-tab close
  // moves focus to the (about-to-be-removed) close button without changing this
  // pane's `focused`, so the nonce is what repairs it before the browser's
  // non-deterministic focus-after-removal lands (the linux flake this fixes).
  createEffect(
    on(
      () => [props.focused, props.refocusNonce] as const,
      () => {
        // A dock/canvas click writes selection from its click handler, before
        // the browser has necessarily finished its own focus default. Focusing
        // synchronously here lets that final default put focus back on the row.
        // Re-check after the event turn and apply the already-written fact to
        // the DOM; no selection write occurs on this path.
        queueMicrotask(() => {
          if (props.focused && props.visible) {
            focusOnSelection();
          }
        });
      },
      { defer: true },
    ),
  );

  // Refocus terminal when search bar closes — only if this terminal should have focus.
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
    // Marks the terminal subtree as Cmd/Ctrl+F's focus scope: while focus is
    // anywhere in here (the xterm or its SearchBar), the chord opens kolu's
    // terminal search; outside any terminal it defers to the browser's native
    // find-in-page. The global dispatcher reads this marker via the
    // `findInTerminal` action's `focusScopeMarker` (input/actions.ts).
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
            // A search jump scrolls the viewport to the match — user intent, so
            // the scroll-lock latch may engage and hold output while the user
            // inspects it (#1272).
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
          // focusOnSelection is a no-op on touch: tapping the scroll-to-bottom
          // FAB to catch up on output must not summon the soft keyboard (only an
          // explicit tap on the terminal does). Desktop still refocuses so the
          // user can keep typing.
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
          // Keep a solid block cursor even when xterm thinks we're unfocused.
          // The default 'outline' is a hollow box effectively invisible at phone
          // DPI, and xterm's WebGL renderer flips to the inactive style whenever
          // `document.hasFocus()` is false — unreliable on iOS Safari with the
          // soft keyboard up (CoreBrowserService.ts:55).
          cursorInactiveStyle: "block",
          // Reflow the cursor's own wrapped line when the grid narrows. xterm
          // defaults this off ("the shell will redraw it"), but kolu refits
          // constantly — a long URL printed without a trailing newline sits on
          // the cursor line, and without this its overflow is truncated instead
          // of rewrapped, so a clicked web-link opens a clipped address.
          reflowCursorLine: true,
          // Required by SerializeAddon and ImageAddon for buffer access.
          allowProposedApi: true,
        }}
        // Filter terminal query responses from onData before sending to PTY. The
        // server's headless xterm already answers these; duplicates arriving late
        // over the network get printed as visible garbage. Fold any sticky
        // Ctrl/Alt armed on the mobile key bar into the keystroke (no-op on
        // desktop, where nothing is ever armed).
        //
        // THE LOCK is the next gate: xterm's `onData` carries BOTH keys and a
        // text paste, so one check here covers every byte a person types into
        // this terminal. A query response is the terminal answering kolu, not
        // a person, and is dropped above before the gate ever sees it; a
        // focus or wheel report is a person READING (clicking into the tile,
        // scrolling a mouse-tracking TUI), so it passes the gate unasked.
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
              // A keystroke has no UI to report to — the terminal is the
              // feedback — which is what the old bare `void` meant.
              .pipe(Effect.ignore),
          );
        }}
        onReady={onReady}
        onTap={onTap}
        // Injected web-link seam — loopback URLs raise the join card; ⌘-click
        // and non-loopback keep a raw open. Lives beside fileRefLinkProvider.
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
        // touch-manipulation: eliminate 300ms tap delay and prevent
        // double-tap-to-zoom on mobile. data-[drop-target]: inset ring while a
        // file drag is hovering — set/cleared by the dragover/drop/dragleave
        // listeners in onReady.
        class="w-full h-full overflow-hidden touch-manipulation data-[drop-target]:outline data-[drop-target]:outline-2 data-[drop-target]:-outline-offset-2 data-[drop-target]:outline-sky-400/70"
        data-terminal-id={props.terminalId}
        data-visible={props.visible ? "" : undefined}
        data-focused={isFocused() ? "" : undefined}
        data-sub-terminal={props.isSub ? "" : undefined}
        data-font-size={fontSize()}
        data-renderer={(handle()?.webgl.hasWebgl() ?? false) ? "webgl" : "dom"}
      />
      {/* THE LOCK, on the terminal's own BODY — the thin frame that says the
       *  Conductor is driving this terminal, the card a blocked keystroke
       *  raises, and the "Hand back" pill while the person has it. Here
       *  rather than in the tile's title bar (which the phone does not even
       *  have) because the frame IS the body's edge, and because a card that
       *  answers typing has to be where the typing went. Nothing is drawn
       *  for a terminal no work drives, which is every terminal outside a
       *  waterfall. */}
      <WorkLock terminal={activeTerminalRef(props.terminalId)} />
      {/* Join card for a printed loopback URL — only while this terminal owns the
       *  open card. Portal-rendered; lives here so App stays a thin shell. */}
      <PrintedUrlCardMount terminalId={props.terminalId} />
    </div>
  );
};

export default Terminal;
