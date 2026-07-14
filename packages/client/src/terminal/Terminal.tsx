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
import type { SearchAddon } from "@xterm/addon-search";
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
import { createSnapshotBoundary } from "@kolu/xterm-kit";
import {
  type BackfillController,
  createBackfillController,
} from "@kolu/xterm-kit/backfill";
import { cellAtPoint, readBufferBytes } from "@kolu/xterm-kit/internals";
import { Xterm, type XtermHandle } from "@kolu/xterm-kit/solid";
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
import { activePadiRpc, preferences } from "../wire";
import {
  createFileRefLinkProvider,
  fileRefAtCell,
} from "./fileRefLinkProvider";
import { deliverScratchPaste } from "./pasteDelivery";
import { consumeReattachingStream } from "./reattachingStream";
import ScrollToBottom from "./ScrollToBottom";
import SearchBar from "./SearchBar";
import { applyStickyModifiers } from "./stickyModifiers";
import { registerTerminalRefs, unregisterTerminalRefs } from "./terminalRefs";
import { useTerminalActivity } from "./useTerminalActivity";
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

/** How long to suppress the live-activity ping after the client resizes a PTY.
 *  Covers the resize round-trip + the shell's repaint so a reveal/resize of a
 *  quiet tile doesn't flash its live ring; short enough not to swallow genuine
 *  output for long. (See `publishDimensions` + `useTerminalActivity.suppress`.) */
const RESIZE_ACTIVITY_SUPPRESS_MS = 600;

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
  /** Fired when the user interacts with this terminal (click/keyboard focus). */
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
  let terminal: XTerm | null = null;
  let linkProviderDisposable: { dispose(): void } | null = null;
  let backfill: BackfillController | null = null;
  let streamAbort: AbortController | null = null;
  let disposeDiagnostics: (() => void) | null = null;
  let webglTrackerId: number | null = null;
  const [searchAddon, setSearchAddon] = createSignal<SearchAddon | null>(null);
  const [handle, setHandle] = createSignal<XtermHandle | null>(null);
  const terminalStore = useTerminalStore();
  const activity = useTerminalActivity();

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
    if (!isTouch()) terminal?.focus();
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
    if (!terminal) return false;
    const cell = cellAtPoint(terminal, clientX, clientY);
    if (!cell) return false;
    const bufferLine = terminal.buffer.active.viewportY + cell.row;
    const ref = fileRefAtCell(terminal, cell.col, bufferLine);
    if (ref) {
      activateFileRef(ref);
      return true;
    }
    return false;
  };

  /** Resize the server-side PTY so node-pty matches the xterm grid. Driven by
   *  <Xterm>'s onResize (term.onResize + the post-fit initial publish). */
  async function publishDimensions(size: { cols: number; rows: number }) {
    const { cols, rows } = size;
    if (cols <= 0 || rows <= 0) return;
    // A PTY resize makes the shell REPAINT (SIGWINCH) — a genuine delta on the
    // attach stream, but not real activity. Suppress the live-activity ping for
    // a beat so revealing/resizing a quiet tile doesn't blip its live ring off
    // the resize's own repaint (the round-trip + repaint settles well inside the
    // window). Armed BEFORE the resize so the repaint can't slip in first.
    activity.suppress(props.terminalId, RESIZE_ACTIVITY_SUPPRESS_MS);
    try {
      await activePadiRpc.surface.lifecycle.resize({
        id: props.terminalId,
        cols,
        rows,
      });
    } catch {
      // Terminal may have been killed mid-resize
    }
  }

  // Wire kolu's policy over the live terminal. Runs inside <Xterm>'s reactive
  // owner, so every listener / disposable registered here is cleaned up on
  // disposal alongside the terminal the kit owns.
  const onReady = (h: XtermHandle) => {
    setHandle(h);
    const term = h.terminal;
    terminal = term;
    setSearchAddon(h.addons.search);

    // Kolu-owned bridge consumed by e2e step definitions — `support/buffer.ts`,
    // `step_definitions/file_ref_link_steps.ts`, and friends read
    // `container.__xterm` to drive xterm's public API (buffer reads,
    // cell-to-pixel math). Removing this silently breaks every cucumber test
    // that touches terminal contents. Cleared in onCleanup.
    (h.container as HTMLElement & { __xterm?: XTerm }).__xterm = term;

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
        webglAtlas: () => h.textureAtlasSize(),
        bufferBytes: () => readBufferBytes(term),
        scrollLockEvents: () => h.scrollLock.events(),
        ...h.recovery.probes,
      },
    });
    // Diagnostics subscribes to hasWebgl via accessor — keeps it the single
    // source of truth, no imperative updater to forget.
    disposeDiagnostics = registerDiagnostics(props.terminalId, {
      xterm: term,
      renderer: () => (h.hasWebgl() ? "webgl" : "dom"),
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

    // Track user-initiated focus for "remember last focused" in sub-panel
    if (props.onFocus && term.textarea) {
      makeEventListener(term.textarea, "focus", props.onFocus);
    }

    // On tab re-show, re-fit, clear the atlas, flush a lock engaged while hidden
    // (#1272), and force a sync repaint of a possibly parked-rAF frame.
    refitOnTabVisible(
      () => {
        h.refit();
        h.clearTextureAtlas();
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
        activePadiRpc.surface.screen.history({
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
    // (scrollback), not live output — see `terminal.attach` in router.ts.
    // Lighting the live dot for it would mean a quiet terminal with scrollback
    // flashes "live" for ~1s on every mount, mode remount, or reconnect retry —
    // the indicator lying exactly when a glance across the workspace relies on
    // it. The snapshot boundary swallows that one frame's `noteOutput`, then
    // every later chunk is a genuine PTY delta. It re-arms in `onRetry` because a
    // transparent re-subscribe replays a fresh snapshot first too. The snapshot
    // is still WRITTEN to xterm; only the activity ping is suppressed.
    const snapshotBoundary = createSnapshotBoundary();
    // Reset xterm + the scroll lock and re-arm the snapshot boundary so the NEXT
    // stream's first frame (a fresh snapshot) replaces stale bytes without
    // double-painting. Shared by the inner `onRetry` (a transparent STREAM_RETRY
    // re-subscribe on a transport blip) and the outer re-attach (a mid-chain padi
    // death STREAM_RETRY won't retry — done-criterion (c)).
    const resetForFreshSnapshot = () => {
      terminal?.reset();
      h.scrollLock.reset();
      snapshotBoundary.armSnapshot();
      // Forget the backfill cursor: the next frame is a fresh snapshot that
      // re-seeds it (below). Fetching against the old cursor would splice onto
      // the terminal we just reset.
      backfill?.reset();
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
    consumeReattachingStream(
      () =>
        unenrolledStreamCall(
          activePadiRpc.surface.terminalAttach.get,
          { id: props.terminalId },
          { signal, onRetry: resetForFreshSnapshot },
        ),
      (frame) => {
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
        if (terminal) {
          // Every chunk AFTER the snapshot boundary is live output — light the
          // terminal's live-activity dot (dock + title), even when scroll-locked
          // (the bytes still arrived; the user just isn't at the bottom). The
          // store debounces back to static after a quiet gap.
          if (snapshotBoundary.isLiveDelta()) {
            activity.noteOutput(props.terminalId);
          }
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
        scratchWrite: (args) => activePadiRpc.surface.scratch.write(args),
        isActive: () =>
          activeArm(terminalStore.getMetadata(props.terminalId)) !== undefined,
        sendInput: (args) => activePadiRpc.surface.lifecycle.sendInput(args),
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

  // Policy teardown. The kit (<Xterm>) owns disposing the terminal + addons and
  // the WebGL context; here we release only THIS component's retained references
  // and kolu-side registrations, so no closure keeps the xterm graph reachable
  // (#606). Registered synchronously in the body so it fires even if the owner is
  // disposed during <Xterm>'s font await.
  onCleanup(() => {
    lifecycleCounters.cleanups++;
    streamAbort?.abort();
    unregisterTerminalRefs(props.terminalId);
    activity.forget(props.terminalId);
    disposeDiagnostics?.();
    disposeDiagnostics = null;
    linkProviderDisposable?.dispose();
    linkProviderDisposable = null;
    backfill?.dispose();
    backfill = null;
    terminal = null;
    setSearchAddon(null);
    const h = handle();
    if (h)
      (h.container as HTMLElement & { __xterm?: XTerm }).__xterm = undefined;
    setHandle(null);
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
        if (props.focused && props.visible) focusOnSelection();
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
      <Show when={searchAddon()}>
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
          if (h && terminal) h.scrollLock.scrollToBottom(terminal);
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
          void activePadiRpc.surface.lifecycle.sendInput({
            id: props.terminalId,
            data: applyStickyModifiers(data),
          });
        }}
        onResize={(size) => void publishDimensions(size)}
        onReady={onReady}
        onTap={onTap}
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
        data-renderer={(handle()?.hasWebgl() ?? false) ? "webgl" : "dom"}
      />
    </div>
  );
};

export default Terminal;
