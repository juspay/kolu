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
import { SafeClipboardProvider, writeTextToClipboard } from "../ui/clipboard";
import "@xterm/xterm/css/xterm.css";
import { TERMINAL_RESET } from "@kolu/padi/endpoint";
import { activeArm } from "@kolu/padi/surface";
import { rejectionFor, sizeRejectionFor } from "@kolu/padi/upload";
import { unenrolledStreamCall } from "@kolu/surface/client";
import {
  isTerminalQueryResponse,
  wrapBracketedPaste,
} from "@kolu/terminal-protocol";
import {
  type BackfillController,
  createBackfillController,
} from "@kolu/xterm-kit/backfill";
import { cellAtPoint, readBufferBytes } from "@kolu/xterm-kit/internals";
import {
  type TerminalGrid,
  Xterm,
  type XtermHandle,
} from "@kolu/xterm-kit/solid";
import { DEFAULT_SCROLLBACK } from "kolu-common/config";
import type { TerminalId } from "kolu-common/surface";
import { FONT_FAMILY } from "terminal-themes";
import {
  ACTIONS,
  matchesAnyShortcut,
  TERMINAL_SEARCH_ATTR_PROP,
} from "../input/actions";
import { matchesKeybind } from "../input/keyboard";
import { createZoom } from "../input/zoom";
import { refitOnTabVisible } from "../refitOnTabVisible";
import { openInCodeTab } from "../right-panel/openInCodeTab";
import type { LineRef } from "../ui/lineRef";
import { isTouch } from "../useMobile";
import { activePadiRpc, activePadiStreams, preferences } from "../wire";
import {
  createFileRefLinkProvider,
  fileRefAtCell,
} from "./fileRefLinkProvider";
import { handleWebLink } from "./handleWebLink";
import { PrintedUrlCardMount } from "./PrintedUrlCard";
import { deliverScratchPaste } from "./pasteDelivery";
import { consumeReattachingStream } from "./reattachingStream";
import ScrollToBottom from "./ScrollToBottom";
import SearchBar from "./SearchBar";
import { applyStickyModifiers } from "./stickyModifiers";
import { registerTerminalRefs, unregisterTerminalRefs } from "./terminalRefs";
import { registerDiagnostics } from "./useTerminalDiagnostics";
import { useTerminalStore } from "./useTerminalStore";
import { installTerminalFocusProvenance } from "./focusProvenance";
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
  let streamAbort: AbortController | null = null;
  let disposeDiagnostics: (() => void) | null = null;
  let webglTrackerId: number | null = null;
  const [handle, setHandle] = createSignal<XtermHandle | null>(null);
  const terminalStore = useTerminalStore();

  // Gate zoom on `focused`, not `visible`: in canvas mode every tile is
  // `visible` (so inactive xterms stay sized), so a `visible` gate let every
  // tile's capture-phase zoom listener fire at once — Cmd/Ctrl +/- zoomed all
  // terminals together (#1238). `focused` is true for exactly one tile (the
  // active one in canvas; the single visible one in mobile), so only it zooms.
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
   *  keeps mobile (one visible tile) and collapsed splits off WebGL regardless of
   *  recency. Distinct from `isFocused` (zoom + `data-focused`): a budgeted tile
   *  holds WebGL even when it isn't the focused one. */
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
    const repoRoot = meta?.git?.repoRoot ?? null;
    if (!repoRoot) return;
    openInCodeTab({ ref, repoRoot, cwd: meta?.cwd, targetMode: "browse" });
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

  /** Resize the server-side PTY so node-pty matches the xterm grid. Driven off
   *  `XtermHandle.grid` — the one door a measured grid leaves the kit through. */
  async function publishDimensions(size: TerminalGrid) {
    const { cols, rows } = size;
    // A PTY resize makes the shell REPAINT (SIGWINCH) — but that repaint no
    // longer needs suppressing here: kaval excludes resize repaints from its
    // meaningful-output edge at the source, so the live dot (mirrored off padi's
    // `activity` set) never lights on a reveal/resize in the first place.
    try {
      await activePadiRpc.lifecycle.resize({
        id: props.terminalId,
        cols,
        rows,
      });
    } catch (err) {
      // A killed terminal is the one EXPECTED loss here (the tile tears down via
      // terminalExit), and it is not worth a toast. Anything else means this
      // pane's size claim did NOT land — and since `reassertGrid` below rides
      // this same channel as the ONLY repair for a replayed stale grid, letting
      // it fall into a bare `catch {}` would leave the user with exactly the
      // stuck garbled screen this path exists to prevent, with no trace to find
      // it by. So it surfaces (see `.agency/code-police.md` →
      // caught-error-must-not-collapse-to-empty) rather than collapsing to a
      // no-op.
      console.warn(
        `terminal ${props.terminalId}: resize to ${cols}x${rows} did not land`,
        err,
      );
    }
  }

  // Wire kolu's policy over the live terminal. Runs inside <Xterm>'s reactive
  // owner, so every listener / disposable registered here is cleaned up on
  // disposal alongside the terminal the kit owns.
  const onReady = (h: XtermHandle) => {
    setHandle(h);
    const term = h.terminal;

    // Kolu-owned bridge consumed by e2e step definitions — `support/buffer.ts`,
    // `step_definitions/file_ref_link_steps.ts`, and friends read
    // `container.__xterm` to drive xterm's public API (buffer reads,
    // cell-to-pixel math). Removing this silently breaks every cucumber test
    // that touches terminal contents. Cleared in the teardown below.
    (h.container as HTMLElement & { __xterm?: XTerm }).__xterm = term;

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
      streamAbort?.abort();
      unregisterTerminalRefs(props.terminalId);
      disposeDiagnostics?.();
      disposeDiagnostics = null;
      linkProviderDisposable?.dispose();
      linkProviderDisposable = null;
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
      xterm: term,
      renderer: () => (h.webgl.hasWebgl() ? "webgl" : "dom"),
      // The gate on ALL bytes. `cols`/`rows` above are read off xterm, which
      // reports its invented 80×24 for a pane that has never measured its own
      // box — so without this the dialog cannot tell "waiting to be measured,
      // no attach stream open" from "attached and quiet". On screen the two are
      // identical (a blank terminal), which is why the fact has to be named
      // somewhere the code can see it.
      measured: () => h.grid() !== null,
      scrollLock: {
        locked: h.scrollLock.isLocked,
        pendingChunks: h.scrollLock.pendingChunks,
        lastEvent: h.scrollLock.lastEvent,
      },
    });

    // xterm.js has attachCustomKeyEventHandler for intercepting keys.
    // Return false to prevent xterm from handling the key.
    term.attachCustomKeyEventHandler((e: KeyboardEvent) => {
      // Shift+PageUp / Shift+PageDown are the ONLY chords this xterm build turns
      // into a viewport scroll (KeyboardResultType.PAGE_UP / PAGE_DOWN →
      // scrollLines). Shift+Home/End emit escape SEQUENCES, not scrolls — arming
      // on them would leave a stale intent that an unrelated programmatic
      // off-bottom scroll could latch onto within the window (#1272). So arm
      // only on the keys that actually scroll; the resulting synchronous
      // onScroll must read as user intent or the latch suppresses it. The key
      // still falls through to xterm below.
      if (
        e.type === "keydown" &&
        e.shiftKey &&
        (e.key === "PageUp" || e.key === "PageDown")
      ) {
        h.scrollLock.armUserScrollIntent("keyboard");
      }

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
          writeTextToClipboard(selection)
            .then(() => toast.success("Copied selection to clipboard"))
            .catch((err: Error) => {
              console.error("Failed to copy selection:", err);
              toast.error(`Failed to copy selection: ${err.message}`);
            });
        return false;
      }

      // Let any registered app shortcut bubble through to the capture-phase dispatcher
      if (matchesAnyShortcut(e)) return false;

      return true;
    });

    if (props.onFocus && term.textarea) {
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
          onFocus: props.onFocus,
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

    streamAbort = new AbortController();
    const signal = streamAbort.signal;

    // Scrollback backfill: attach paints only the recent screenful; as the user
    // scrolls up, fetch older chunks from kaval and prepend them into this
    // terminal's own scrollback. Seeded from the attach snapshot's `topLine`
    // (below); self-manages the near-top trigger and the reset/resize races.
    backfill = createBackfillController(term, {
      fetch: (before, max, epoch) =>
        activePadiRpc.screen.history({
          id: props.terminalId,
          before,
          max,
          epoch,
        }),
      // A killed terminal's NOT_FOUND is swallowed inside the controller; any
      // OTHER backfill fetch fault (transport, schema, server) surfaces here
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
    // Reset xterm + the scroll lock so the NEXT stream's first frame (a fresh
    // snapshot) replaces stale bytes without double-painting. Shared by the inner
    // `onRetry` (a transparent STREAM_RETRY re-subscribe on a transport blip) and
    // the outer re-attach (a mid-chain padi death STREAM_RETRY won't retry —
    // done-criterion (c)).
    const resetForFreshSnapshot = () => {
      handle()?.terminal?.reset();
      h.scrollLock.reset();
      // Forget the backfill cursor: the next frame is a fresh snapshot that
      // re-seeds it (below). Fetching against the old cursor would splice onto
      // the terminal we just reset.
      backfill?.reset();
    };
    // The attach stream may not open until this pane has MEASURED its own box.
    //
    // The snapshot the host serializes is bytes laid out FOR A GRID — cursor
    // moves and wraps are only meaningful at the width they were written for.
    // An unmeasured xterm reports the 80×24 its constructor invents, and a pane
    // that is hidden at mount (a collapsed split, a background sub-tab) can
    // never be measured, so it keeps reporting that invented grid. Attaching
    // there paints a screen laid out for the real width into 80 columns;
    // revealing the pane then REFLOWS the damage rather than repainting it, and
    // the repair never comes, because the grid the client finally publishes is
    // the one the PTY already had — and kaval no-ops a same-dimensions resize,
    // so no SIGWINCH ever reaches the process. Only a genuine resize (nudging
    // the divider) fixed it.
    //
    // So: no grid, no bytes. Gating here — rather than dropping or buffering
    // frames after the fact — is what makes the bad state unrepresentable,
    // because the grid is also what we ASK for the snapshot AT (below), and a
    // request can't carry a size we haven't measured.
    //
    // The latch is the kit's (`onceMeasured`), not a local boolean: it owns the
    // measurement hazard, so "wait for a real grid" is one call here rather than
    // a re-derivation of the rule beside the rule.
    h.onceMeasured(() => openAttachStream());

    // The ONE publisher of this pane's grid → the PTY. `grid` is value-compared
    // inside the kit, so this fires exactly once per REAL grid change — the
    // initial fit included — and never for a re-fit that measured nothing new.
    // Driving it from the signal rather than a second `onResize` callback door
    // means "who states this pane's size" has a single answer.
    createEffect(
      on(h.grid, (measured) => {
        if (measured) void publishDimensions(measured);
      }),
    );

    /** Re-state this pane's own grid to the host. `lifecycle.resize` is the one
     *  authoritative channel for a live size change, and this pane is the sole
     *  authority for its value — so re-stating it can only ever correct the
     *  terminal towards what this pane actually has, never away from it. */
    const reassertGrid = () => {
      const measured = h.grid();
      if (measured) void publishDimensions(measured);
    };

    // Carve-out (Leak A): `terminalAttach` is a padi SURFACE stream member
    // (`padiSurface.streams.terminalAttach`), but its health is the terminal's
    // OWN concern — surfaced in-pane (a reset + visible retry on `onRetry`, the
    // snapshot re-armed), not folded into padi's fleet/host `health()` gate. A
    // single terminal's re-attach (overflow re-attach #1591, PTY exit) must never
    // flicker the global connection-health indicator. So it deliberately uses
    // `unenrolledStreamCall` (`@kolu/surface/client`) — the bare, un-enrolled
    // call — rather than `padi.rawStream`'s structural health enrolment, and the
    // `unenrolled-` name makes that a visible decision at the call site.
    function openAttachStream() {
      consumeReattachingStream(
        () => {
          // Read the grid at the moment this stream is opened. Note this thunk
          // is NOT the transport-retry path: `unenrolledStreamCall` invokes the
          // procedure once and oRPC's retry plugin re-subscribes by replaying
          // that captured input, so a STREAM_RETRY re-sends the grid recorded
          // here. `consumeReattachingStream`'s own outer re-attach does re-enter
          // it and picks up a fresh grid. The replay is what `reassertGrid`
          // below exists for.
          //
          // Absent is unreachable — `onceMeasured` opens the stream only once a
          // grid exists, and a measured grid is never un-measured.
          //
          // A bare `throw` here would NOT fail loud: this thunk's throws are
          // caught by `consumeReattachingStream`, classified as an abnormal end,
          // console.warn'd and retried every 300ms — and each retry runs
          // `resetForFreshSnapshot`, which WIPES the user's screen. So the
          // assertion aborts the stream FIRST: the outer `while (!signal.aborted)`
          // then exits after one pass, and the breach surfaces where a user can
          // see it instead of turning into a blank pane blinking 3×/second.
          const measured = h.grid();
          if (!measured) {
            const msg = `terminal ${props.terminalId}: attach opened without a measured grid`;
            toast.error(msg);
            streamAbort?.abort();
            throw new Error(msg);
          }
          return unenrolledStreamCall(
            activePadiStreams.terminalAttach.unenrolled,
            // `resizeTo`, not a description of this pane: the host resizes the
            // shared PTY to it before serializing.
            { id: props.terminalId, resizeTo: measured },
            { signal, onRetry: resetForFreshSnapshot },
          );
        },
        (frame) => {
          // A snapshot means the terminal was just SIZED for someone — possibly
          // for a grid this pane no longer has. A transport retry re-subscribes
          // by replaying the input captured above, so after a resize the replay
          // asks for the OLD grid and drags the PTY back to it. This pane is the
          // authority on its own size, so it re-states that fact right after any
          // event that could have moved the terminal under it, which converts a
          // replayed stale claim into a transient rather than a stuck screen.
          // Free in the steady state: kaval no-ops an exact same-dimensions
          // resize, so the overwhelmingly common "nothing moved" case costs one
          // comparison and no SIGWINCH.
          if (frame.kind === "snapshot") reassertGrid();
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
          const commitSeed =
            frame.kind === "snapshot"
              ? backfill?.consumeSnapshotFrame(
                  frame.topLine,
                  frame.reflowEpoch,
                  // An overflow re-attach snapshot's data LEADS with a RIS
                  // (`TERMINAL_RESET + snapshot`); the initial attach does not. The
                  // controller's esc handler pauses on THIS frame's own leading RIS
                  // too, so the controller must know it's coming: the seam captures
                  // the committer's baseline one generation-bump BEFORE that RIS and
                  // PREDICTS it, so the frame's own reset doesn't read as an
                  // invalidation that revokes this frame's re-seed — otherwise
                  // backfill pauses forever after a re-attach (F11).
                  frame.data.startsWith(TERMINAL_RESET),
                )
              : undefined;
          // A consumed snapshot frame carries its OWN seed seam (with a per-frame
          // token) so the controller captures its committer baseline at the
          // snapshot's byte position, not at receipt — the F11 fix under scroll
          // lock, where a foreign RIS buffered ahead of this snapshot would
          // otherwise steal its seed. The controller mints the seam bytes
          // (`commitSeed.seam`); prepended ONLY when a controller actually consumed
          // the frame, so the seam and the controller's pending-seed FIFO stay 1:1.
          const data = commitSeed
            ? `${commitSeed.seam}${frame.data}`
            : frame.data;
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
            h.write(data, () => {
              h.recovery.noteData();
              // Seed the backfill cursor now that this snapshot has landed in the
              // buffer (see the note above the write) — undefined, hence a no-op,
              // for a plain delta frame, which carries no `topLine`.
              commitSeed?.commit();
            });
          }
        },
        resetForFreshSnapshot,
        signal,
        "Terminal attach",
      );
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
    async function writeScratchAndPaste(name: string, base64: string) {
      await deliverScratchPaste({
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

    async function uploadPastedImage(file: File) {
      const reason = sizeRejectionFor("clipboard image", file.size);
      if (reason !== null) {
        toast.error(reason);
        return;
      }
      try {
        const base64 = bufferToBase64(await file.arrayBuffer());
        await writeScratchAndPaste("image.png", base64);
      } catch (err) {
        toast.error(`Failed to upload clipboard image: ${errMsg(err)}`);
      }
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
        void uploadPastedImage(file);
      },
      { capture: true },
    );

    // Drag-and-drop file upload. Files dropped on the terminal are uploaded to
    // the server, which saves them under the terminal's clipboard directory and
    // bracketed-pastes the path into the PTY — the same shape as Ctrl+V image
    // paste, just sourced from DataTransfer instead of ClipboardData.
    async function uploadDroppedFile(file: File) {
      const reason = rejectionFor(file.name, file.size);
      if (reason !== null) {
        toast.error(reason);
        return;
      }
      try {
        const base64 = bufferToBase64(await file.arrayBuffer());
        await writeScratchAndPaste(file.name, base64);
      } catch (err) {
        toast.error(`Failed to upload "${file.name}": ${errMsg(err)}`);
      }
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
        void uploadDroppedFile(file);
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
      classList={{ hidden: !props.visible }}
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
        webgl={shouldUseWebgl}
        scrollLockEnabled={() => preferences().scrollLock}
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
        onData={(data) => {
          if (isTerminalQueryResponse(data)) return;
          void activePadiRpc.lifecycle.sendInput({
            id: props.terminalId,
            data: applyStickyModifiers(data),
          });
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
      {/* Join card for a printed loopback URL — only while this terminal owns the
       *  open card. Portal-rendered; lives here so App stays a thin shell. */}
      <PrintedUrlCardMount terminalId={props.terminalId} />
    </div>
  );
};

export default Terminal;
