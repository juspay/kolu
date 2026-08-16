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
import type { ITheme } from "terminal-themes";
import {
  type Component,
  createEffect,
  createSignal,
  on,
  onCleanup,
  Show,
} from "solid-js";
import { toast } from "solid-sonner";
import { writeTextToClipboard } from "../ui/clipboard";
import { TERMINAL_RESET } from "@kolu/padi/endpoint";
import { activeArm } from "@kolu/padi/surface";
import { rejectionFor, sizeRejectionFor } from "@kolu/padi/upload";
import { unenrolledStreamCall } from "@kolu/surface/client";
import { toError } from "@kolu/surface/run-stream";
import {
  isTerminalQueryResponse,
  wrapBracketedPaste,
} from "@kolu/terminal-protocol";
import {
  type BackfillController,
  createBackfillController,
} from "@kolu/ghostty-kit/backfill";
import {
  Ghostty,
  type GhosttyHandle,
  sameGrid,
  type TerminalGrid,
} from "@kolu/ghostty-kit/solid";
import { Effect, type Fiber } from "effect";
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

import { isDeclared, TERMINAL_NOT_FOUND } from "../rpc/declaredErrors";
import {
  runAction,
  runActionPromise,
  runOwnedAction,
  type UiAction,
} from "../runAction";

import { isTouch } from "../useMobile";
import {
  activeHost,
  activePadiRpc,
  activePadiStreams,
  padiMap,
  preferences,
} from "../wire";
import { createAttemptGate, onlyWhenCurrent } from "./attachAttempts";
import { installTerminalFocusProvenance } from "./focusProvenance";
import { PrintedUrlCardMount } from "./PrintedUrlCard";
import { deliverScratchPaste } from "./pasteDelivery";
import { createGridPublisher } from "./publishGrid";
import {
  consumeReattachingStream,
  REATTACH_BACKOFF_MS,
  StaleSnapshotGrid,
} from "./reattachingStream";
import ScrollToBottom from "./ScrollToBottom";
import SearchBar from "./SearchBar";
import { applyStickyModifiers } from "./stickyModifiers";
import { registerTerminalRefs, unregisterTerminalRefs } from "./terminalRefs";
import { registerDiagnostics } from "./useTerminalDiagnostics";
import { useTerminalStore } from "./useTerminalStore";

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
  /** The LIVE attach attempt's fiber — interrupting it ends that attempt's
   *  consume loop and any backoff it is sleeping through. Component-lifetime,
   *  because the teardown below is the component's. */
  let attachFiber: Fiber.Fiber<unknown, never> | null = null;
  /** Component teardown latch. Interruption stops the fiber, but it is
   *  ASYNCHRONOUS, and xterm can still invoke a stashed write callback after the
   *  pane is gone — so "am I torn down" stays a synchronous fact, exactly as the
   *  `signal.aborted` it replaces was. */
  let attachTornDown = false;
  /** The pending {@link REATTACH_BACKOFF_MS} pause of a stale-grid reopen — the
   *  fourth reopen lane (kolu#2101 K5). Held so teardown can cancel it, the same
   *  way interrupting `attachFiber` cancels the loop's own sleeping backoff. */
  let staleGridReopenTimer: ReturnType<typeof setTimeout> | null = null;
  let disposeDiagnostics: (() => void) | null = null;
  const [handle, setHandle] = createSignal<GhosttyHandle | null>(null);
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
  // Selection-driven focus. Desktop raises the keyboard when a tile becomes
  // active/visible; on touch that's intrusive — the soft keyboard should only
  // rise from an explicit tap, never as a side-effect of switching/revealing a
  // tile. So this is a no-op on touch.
  function focusOnSelection() {
    if (isTouch()) return;
    handle()?.terminal.focus();
  }

  const onTap = (_clientX: number, _clientY: number): boolean => {
    return false;
  };

  /** The host entry's state KIND for this pane's host — the same fact that
   *  paints the host pip. A terminal is bound to the ACTIVE host (there is no
   *  host prop; that IS the existing mapping), and `padiMap.entry` is the pure,
   *  owner-free point lens (`wire.ts`). */
  const hostEntryKind = () => padiMap.entry(activeHost()).state().kind;

  /** Resize the server-side PTY so node-pty matches the xterm grid. Driven off
   *  `XtermHandle.grid` — the one door a measured grid leaves the kit through.
   *
   *  The POLICY (H1's not-connected suppression, K4's latch, and the convergence
   *  argument for both) lives in `publishGrid.ts`; this binds the three real
   *  facts. A PTY resize makes the shell REPAINT (SIGWINCH) — but that repaint
   *  no longer needs suppressing here: kaval excludes resize repaints from its
   *  meaningful-output edge at the source, so the live dot (mirrored off padi's
   *  `activity` set) never lights on a reveal/resize in the first place.
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
  });

  function publishDimensions(size: TerminalGrid): UiAction {
    return gridPublisher.publish(size);
  }

  // Wire kolu's policy over the live terminal. Runs inside <Xterm>'s reactive
  // owner, so every listener / disposable registered here is cleaned up on
  // disposal alongside the terminal the kit owns.
  const onReady = (h: GhosttyHandle) => {
    setHandle(h);
    const term = h.terminal;

    // Kolu-owned bridge consumed by e2e step definitions — `support/buffer.ts`,
    // `step_definitions/file_ref_link_steps.ts`, and friends read
    // `container.__xterm` to drive xterm's public API (buffer reads,
    // cell-to-pixel math). Removing this silently breaks every cucumber test
    // that touches terminal contents. Cleared in the teardown below.
    (
      h.container as HTMLElement & { __xterm?: GhosttyHandle["terminal"] }
    ).__xterm = term;

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
      attachFiber?.interruptUnsafe();
      attachFiber = null;
      if (staleGridReopenTimer !== null) clearTimeout(staleGridReopenTimer);
      staleGridReopenTimer = null;
      unregisterTerminalRefs(props.terminalId);
      disposeDiagnostics?.();
      disposeDiagnostics = null;
      linkProviderDisposable?.dispose();
      linkProviderDisposable = null;
      backfill?.dispose();
      backfill = null;
      (
        h.container as HTMLElement & { __xterm?: GhosttyHandle["terminal"] }
      ).__xterm = undefined;
      setHandle(null);
    });

    // Linkify `path:line[:col][-end]` references in terminal output. The link
    // provider reads repoRoot from the terminal store at click time (not at
    // mount) so a cwd change keeps subsequent clicks anchored to the new repo.
    linkProviderDisposable = term.registerLinkProvider({
      dispose: () => {},
    });

    registerTerminalRefs(props.terminalId, {
      xterm: term,
      serialize: h.addons.serialize,
      probes: {
        webglAtlas: () => h.webgl.textureAtlasSize(),
        bufferBytes: () => null,
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
        lastEvent: () => h.scrollLock.lastEvent() ?? null,
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
    // Reset xterm + the scroll lock so the NEXT stream's first frame (a fresh
    // snapshot) replaces stale bytes without double-painting. Shared by the inner
    // `onRetry` (a transparent STREAM_RETRY re-subscribe on a transport blip) and
    // the outer re-attach (a mid-chain padi death STREAM_RETRY won't retry —
    // done-criterion (c)).
    const resetForFreshSnapshot = () => {
      // Drop write-pipeline pending (coalesce + scroll-lock) WITHOUT writing —
      // a flush would re-paint pre-reset chunks onto the cleared screen.
      h.clearPendingOutput();
      handle()?.terminal?.reset();
      h.scrollLock.reset("drop");
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
    // The ONE publisher of this pane's grid CHANGES → the PTY. (The attach's own
    // `resizeTo` states the grid the pane OPENS at; every change after that
    // travels here.) `grid` is value-compared inside the kit, so this fires
    // exactly once per REAL grid change — the initial fit included — and never
    // for a re-fit that measured nothing new.
    // Driving it from the signal rather than a second `onResize` callback door
    // means "who states this pane's size" has a single answer.
    createEffect(
      on(h.grid, (measured) => {
        if (measured)
          runOwnedAction("publish terminal grid", publishDimensions(measured));
      }),
    );

    // …and the OTHER thing that can owe the PTY a size: a grid change that
    // happened while this pane's host was not connected (kolu#2101 K4). The
    // effect above fires per GRID CHANGE, so nothing re-observes the host coming
    // back — and if the open attach stays silent through the outage there is no
    // re-attach to restate it either, leaving the PTY at its old size with no
    // symptom but wrong output. This watches the host entry instead, and leans
    // on the latch for idempotence: with nothing owed the action is
    // `Effect.void`, and a restatement that lands clears the latch, so the
    // effect's re-runs (and a tile that mounts while the host is already up)
    // cost nothing. Reachable on the LOCAL host too — `daemon.restart` drains
    // it out of `connected`.
    createEffect(
      on(hostEntryKind, (kind) => {
        if (kind === "connected")
          runOwnedAction(
            "publish terminal grid",
            gridPublisher.republishSuppressed(),
          );
      }),
    );

    // Supersession for restartable attach loops: every attempt holds its OWN
    // state in its closure and asks the gate whether it is still the live one.
    // See `attachAttempts.ts`.
    const attempts = createAttemptGate();
    // Kit latch, not a local boolean. Must sit after `attempts`: a synchronous
    // fire would TDZ. The kit's latch is an effect so this is also safe if the
    // grid is already known at registration.
    h.onceMeasured(() => openAttachStream());

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
    function openAttachStream() {
      // ALL of this attempt's state lives here, in its closure — never in a
      // binding a successor could overwrite. `attempt` decides whether this
      // loop's work still counts; `superseded` is this attempt's own teardown
      // latch, set BEFORE its fiber is interrupted.
      const attempt = attempts.open();
      let superseded = false;
      /** The grid THIS attach attempt asked the host to serialize at. Written by
       *  the thunk on every open, read by the snapshot frame that answers it — so
       *  an attempt and the grid it is only valid for are one thing, not two. */
      let requestedGrid: TerminalGrid | null = null;

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

      /** Does a snapshot answered by THIS attempt still describe the pane?
       *
       *  An absent side ANSWERS: with nothing to compare there is no evidence of
       *  a mismatch, and refusing on ignorance would livelock the reopen loop
       *  rather than protect anything. The reachable absences are both benign —
       *  no request has been made yet, or the pane has been disposed and its grid
       *  released. */
      const answersCurrentGrid = (): boolean => {
        const current = h.grid();
        return !requestedGrid || !current || sameGrid(requestedGrid, current);
      };

      /** End this loop and start exactly one replacement — the FOURTH reopen
       *  lane, named in `reattachingStream.ts`'s module-header taxonomy along
       *  with the other three (kolu#2101 K5).
       *
       *  It cannot go through the loop's own error channel and that is why it
       *  exists: the second grid check runs in an xterm WRITE CALLBACK, not in
       *  the iterator, so there is no return value the loop would read. Routing
       *  it through the loop proper would mean plumbing a refusal back out of a
       *  callback the loop has no handle on — surgery, not a cheap re-route — so
       *  what it takes instead is the loop's DISCIPLINE: the same
       *  {@link REATTACH_BACKOFF_MS} pause, in the same order the loop uses
       *  (reset now, re-subscribe after the pause), rather than reopening
       *  instantly and letting one lane jump the queue. Its episode accounting
       *  needs no special case: it fires only after a snapshot has actually been
       *  WRITTEN, and a delivered frame refills both budgets, so the fresh loop
       *  legitimately starts a fresh episode instead of escaping an old one's.
       *
       *  Guarded by `attemptLive()` at every call site, so several superseded
       *  callbacks reaching here produce ONE successor, not a cascade. */
      const reopenForStaleGrid = () => {
        // Latch first, interrupt second — the window between them is exactly
        // where a late frame of this attempt would otherwise land.
        superseded = true;
        attachFiber?.interruptUnsafe();
        resetForFreshSnapshot();
        // The pause is a timer rather than a sleeping fiber because there is no
        // fiber left to sleep in — this attempt's was just interrupted. It is
        // cancelled by the component teardown, which is the same lifetime the
        // interrupt above respects.
        if (staleGridReopenTimer !== null) clearTimeout(staleGridReopenTimer);
        staleGridReopenTimer = setTimeout(() => {
          staleGridReopenTimer = null;
          if (attachTornDown) return;
          openAttachStream();
        }, REATTACH_BACKOFF_MS);
      };

      const consume = consumeReattachingStream(
        () => {
          // Read the grid at the moment this stream is opened, and REMEMBER it:
          // the snapshot that comes back is only meaningful at this exact grid,
          // so the frame handler checks it before painting a single byte.
          //
          // This thunk is NOT the transport-retry path: `unenrolledStreamCall`
          // invokes the procedure once and oRPC's retry plugin re-subscribes by
          // replaying that captured input, so a STREAM_RETRY re-sends the grid
          // recorded here even if the pane has resized since.
          // `consumeReattachingStream`'s own outer re-attach DOES re-enter this
          // thunk and picks up a fresh grid — which is why the frame handler's
          // response to a stale answer is to REFUSE the frame (returning a
          // `StaleSnapshotGrid`, channel 2) and let that outer loop reopen,
          // rather than to paint and correct afterwards.
          //
          // Absent is unreachable — `onceMeasured` opens the stream only once a
          // grid exists, and a measured grid is never un-measured.
          //
          // So a throw here is a DEFECT (channel 1 in `reattachingStream`'s
          // header) and that is what makes it fail loud: the re-attach loop
          // retries FAILURES, so a defect is not retried — it reaches the run
          // edge, which reports it (console + toast) and ends the attach.
          // Retrying it would instead run `resetForFreshSnapshot` every 300ms,
          // blanking the user's pane three times a second. This is the ONE throw
          // on the attach path that means it: the unreachable-by-construction
          // breach, with no repair to attempt. Every recoverable condition on
          // this path is a returned value, never a throw.
          const measured = h.grid();
          if (!measured) {
            throw new Error(
              `terminal ${props.terminalId}: attach opened without a measured grid`,
            );
          }
          requestedGrid = measured;
          return unenrolledStreamCall(
            activePadiStreams.terminalAttach.unenrolled,
            // `resizeTo`, not a description of this pane: the host resizes the
            // shared PTY to it before serializing.
            { id: props.terminalId, resizeTo: measured },
            {
              // Names the PANE, in the framework's `<key>[<id>]` spelling and
              // with the same terminal id the attach loop's log lines carry — a
              // canvas of panes attaches the same member N times, and a
              // liveness table that could not tell them apart would name none
              // of them (kolu#2101 J2).
              label: `terminalAttach[${props.terminalId}]`,
              // The attempt's lifetime IS its fiber — interrupting it tears the
              // subscription down through the stream's own finalizers, so there
              // is no signal to thread into the call (D10/#18). The reset hook
              // stays guarded for the same reason as before: a superseded
              // attempt's retry must not wipe the successor's screen.
              onRetry: resetIfLive,
            },
          );
        },
        (frame) => {
          // A superseded loop delivers NOTHING. Its abort has fired but the
          // iterator settles later, so frames already queued behind it still
          // arrive here — and consuming one would paint into a terminal the
          // successor has already reset.
          if (!attemptLive()) return;
          // REFUSE a snapshot that answers a grid this pane no longer has.
          //
          // A snapshot is bytes laid out for the grid it was serialized at, and
          // THREE paths can make that grid stale between the ask and the answer:
          // a resize while the request is in flight (a reload's one-column
          // layout settle is the common one), a STREAM_RETRY, which re-subscribes
          // by replaying the ORIGINAL captured input, and another client
          // attaching at its own size — `resizeTo` is last-attach-wins on a
          // SHARED pty (`@kolu/padi/surface`'s `PadiTerminalAttachInputSchema`),
          // so a phone joining this terminal resizes it under this pane. Painting
          // the answer anyway and correcting the PTY afterwards does NOT undo the
          // damage — a later SIGWINCH repaints a full-screen app, but nothing
          // rebuilds scrollback that has already been wrapped at the wrong width.
          //
          // So: do not paint at all. RETURNING the refusal fails the attempt in
          // the recoverable channel, and `consumeReattachingStream` resets the
          // screen and reopens through the thunk above, which reads the CURRENT
          // grid. Its 300ms backoff bounds the loop, and a pane that has stopped
          // resizing converges on its first reopen.
          //
          // It is a RETURN and not a throw because that promise has to be true.
          // Spelled as a throw, this refusal was a defect the failure-only retry
          // never saw: the loop died, the pane went permanently blank over a live
          // agent, and the toast said "reopening" (kolu#2101 deploy #2 incident
          // #3 — three panes at once on a 66→65 column settle, and again from a
          // phone attaching mid-session). The channel is now in the type.
          //
          // This is the FIRST of two checks — the cheap guard that stops the
          // common case before a single byte is written or any backfill state is
          // touched. Receipt is not when the bytes LAND, so the write callback
          // re-checks; the why is stated in full there.
          if (frame.kind === "snapshot" && !answersCurrentGrid()) {
            return new StaleSnapshotGrid({
              terminalId: props.terminalId,
              requested: requestedGrid,
              current: h.grid(),
            });
          }
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
              // SECOND grid check — this is where the bytes actually landed.
              // Receipt is not that moment: the write above parses
              // asynchronously, and scroll lock stashes the chunk until unlock,
              // which the user controls. A pane that resized inside that window
              // has just had a snapshot for the OLD grid parsed into it, so the
              // seed computed from those bytes must not be committed (it would
              // anchor backfill to a layout the buffer no longer has) and the
              // screen must be repainted from a snapshot for the grid it now is.
              // The frame handler's REFUSAL channel is unavailable here — this
              // runs in an xterm callback, not the iterator, so there is no
              // return value the loop will read — and the attempt is aborted and
              // reopened explicitly instead. Same repair, same promise (a reopen
              // really does follow), reached by the one route this callsite has.
              // The first stale callback installs the one replacement; the rest
              // are superseded by the guard above.
              if (commitSeed && !answersCurrentGrid()) {
                reopenForStaleGrid();
                return;
              }
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
      <Ghostty
        theme={props.theme}
        fontSize={fontSize()}
        visible={props.visible}
        scrollLockEnabled={() => preferences().scrollLock}
        fullRate={isFocused}
        fontFamily={FONT_FAMILY}
        scrollback={DEFAULT_SCROLLBACK}
        // Filter terminal query responses from onData before sending to PTY. The
        // server's headless xterm already answers these; duplicates arriving late
        // over the network get printed as visible garbage. Fold any sticky
        // Ctrl/Alt armed on the mobile key bar into the keystroke (no-op on
        // desktop, where nothing is ever armed).
        onData={(data) => {
          if (isTerminalQueryResponse(data)) return;
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
