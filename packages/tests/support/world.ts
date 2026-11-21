/**
 * Cucumber World — holds Playwright page + terminal helpers.
 * One instance per scenario. Browser context created in hooks.ts.
 */

import {
  setDefaultTimeout,
  setWorldConstructor,
  World,
} from "@cucumber/cucumber";
import type {
  Browser,
  BrowserContext,
  Download,
  Locator,
  Page,
} from "playwright";
// Side-effect import: pulls in the `Window`/`HTMLDivElement`/`Navigator`
// augmentations every step definition needs (window.__readXtermBuffer,
// `__xterm` on tile divs, the Badging API stubs, …) so tests can read
// them without `(window as any)` / `(this as any)` casts.
import "kolu-common/test-hooks";

/** Per-step / per-hook budget for interaction polls — `waitFor` /
 *  `waitForFunction` against a settled UI. Most step definitions reach
 *  for this. */
export const POLL_TIMEOUT = 20_000;

/** How long a pane's grid needs before it CAN have changed.
 *
 *  A pane no longer resizes its own xterm when its box moves: it states the
 *  grid its box can hold, the client publishes that once the measurement has
 *  held still (`GRID_SETTLE_MS`, 250 ms), and the pane adopts the new grid
 *  only where the daemon's mirror did — at the resize frame on the attach
 *  stream. So "the grid did NOT change" is a claim about a round trip, and an
 *  assertion that reads the grid sooner is only observing that the answer has
 *  not arrived yet: it would pass against a pane that is about to resize.
 *  Every such negative hold must outlast THIS. Sized for the settle plus a
 *  publish and an answer on a loaded runner — well short of `POLL_TIMEOUT`,
 *  because a hold is paid in full on every passing run. */
export const GRID_ROUND_TRIP_MS = 3_000;

/** Per-step budget for *hydration* polls — waiting for the app to mount
 *  enough state that interaction is meaningful (server WS up, savedSession
 *  reflected, file-tree populated). The hydration axis is volatile
 *  separately from interaction: a loaded darwin runner can take 30 s+ for
 *  the Pierre file tree to flip from empty to populated (branch mode +
 *  server-side `git status` round-trip), but the *first* interaction
 *  after that lands in ~200 ms. Splitting the constants keeps one slow
 *  axis from forcing the rest of the suite to wait. Generous margin
 *  here is on purpose — empirically the slow path hits 30 s on the
 *  darwin CI runner, and the safety-net Cucumber retry only absorbs
 *  one re-run per scenario. */
export const HYDRATION_TIMEOUT = 60_000;

const READY_TIMEOUT = HYDRATION_TIMEOUT;

/** Cucumber outer-kill timeout. Derived so the relationship
 *  `POLL_TIMEOUT < HYDRATION_TIMEOUT < setDefaultTimeout` is structural —
 *  bumping either inner constant cannot silently make the outer envelope
 *  too tight to surface the inner timeout's real error message. */
const STEP_GUARD = 10_000;
setDefaultTimeout(Math.max(POLL_TIMEOUT, HYDRATION_TIMEOUT) + STEP_GUARD);
export const MOD_KEY = process.platform === "darwin" ? "Meta" : "Control";

/** kolu's APPLICATION modifier — Cmd on macOS, Super elsewhere. Mirrors the
 *  `"app"` `ChordModifier` in `input/keyboard.ts`: the one role a PTY never sees,
 *  so it is what the chords held over a live terminal use (command palette,
 *  new terminal, find-in-terminal). Playwright's "Meta" is Cmd/Super/Win on
 *  every platform, so unlike `MOD_KEY` this needs no platform branch. Reach for
 *  `MOD_KEY` only for a chord whose Ctrl form is inert in a PTY (digits, zoom,
 *  Ctrl+Shift+…). */
export const APP_KEY = "Meta";

/** Locator for the app's settled state: a visible terminal screen, a dormant
 *  (sleeping) tile body, the empty state tip, or the Conductor. A canvas
 *  holding only sleeping tiles is fully settled — its tiles render a PTY-less
 *  `dormant-tile-body` (no `.xterm-screen`), and it is NOT the empty state —
 *  so the dormant body is the third settled shape a reload/converge can land
 *  on. The FOURTH is the Conductor: it is a place you can reload into (the
 *  selected tab persists), and it covers the canvas — so after a reload that
 *  lands there NO tile has ever been seen, nothing is inside the grace
 *  period that would keep a pane shown (kolu#2362), and the page is settled
 *  when the conversation is up. */
const SETTLED_SELECTOR =
  '[data-visible] .xterm-screen, [data-testid="dormant-tile-body"], [data-testid="empty-state"], [data-testid="conductor-pane"]';
/** Touch-device media query — mirrors `isTouch` in packages/client/src/useMobile.ts.
 *  The test package can't import from client src, so the literal is named here to
 *  keep the one place it's duplicated legible and self-documenting. Exported so
 *  step definitions can gate touch-specific waits (e.g. the suppressed
 *  refocus-terminal-on-dialog-close) on the same query. */
export const COARSE_POINTER_QUERY = "(pointer: coarse)";
/** Canonical "list of terminals" affordance — one row per terminal in
 *  the dock. Replaced the chrome-bar workspace-switcher pill
 *  strip with #903; the surface is different, the semantics are the
 *  same (one entry per live terminal with `data-terminal-id`,
 *  `data-active`, `data-unread`, etc.). */
export const DOCK_ROW_SELECTOR = '[data-testid="dock-row"]';
/** Per-tile elements on the canvas — one per top-level terminal. Mobile
 *  uses the mobile-tile-view body to enumerate terminals instead. */
export const CANVAS_TILE_SELECTOR = '[data-testid="canvas-tile"]';
/** The active top-level tile. Activity markers also appear on nested controls,
 *  so consumers must retain the tile-identity qualifier. */
export const ACTIVE_CANVAS_TILE_SELECTOR = `${CANVAS_TILE_SELECTOR}[data-active]`;

let terminalCommandSequence = 0;

export class KoluWorld extends World {
  browser!: Browser;
  context!: BrowserContext;
  page!: Page;
  errors: string[] = [];

  // Stashed state for comparison across steps
  savedSessionTerminalCount?: number;
  savedSessionTerminals?: import("kolu-common").SavedTerminal[];
  /** Captured on the first saved-session POST per scenario; replayed
   *  verbatim on self-heal re-POSTs so assertions always exercise the
   *  originally-persisted session, not a fresh one. */
  savedSessionSavedAt?: number;
  /** The saved session's `activeTerminalId`, stashed on the first POST for the
   *  same reason as `savedSessionSavedAt` — `test__set` writes the WHOLE blob and
   *  an omitted key decodes to `null`, so a self-heal re-POST that dropped it
   *  would ERASE the marker the scenario is about to assert on. */
  savedSessionActiveId?: string;
  savedCanvas?: { x: number; y: number; width: number; height: number };
  previousCanvas?: { x: number; y: number; width: number; height: number };
  savedFontSize?: number;
  /** One coherent pre-zoom snapshot captured atomically by `I note the font
   *  size of each terminal` for the #1238 zoom-isolation regression: the
   *  per-terminal font sizes keyed by data-terminal-id (`sizes`) plus the id
   *  of the tile focused at that instant (`focusedId`) — the only tile
   *  permitted to change on a subsequent zoom. Kept as one field so the
   *  "captured together" invariant is mechanical, not a convention. */
  savedTerminalZoom?: {
    sizes: Record<string, number>;
    focusedId: string | null;
  };
  lastResponseText?: string;
  lastResponseOk?: boolean;
  /** The browser download a Code-tab tree-menu step captured, so a follow-up
   *  step can assert the saved name and bytes. */
  lastDownload?: Download;
  terminalCountBeforeRefresh?: number;
  /** The padi + kaval gate pids captured by `I capture the padi and kaval
   *  daemon pids`, read back by the `@kaval-restart` arms to prove a
   *  `recycleKaval` CHANGES the kaval gate pid (the daemon was recycled) while
   *  the padi gate pid stays UNCHANGED (padi stayed up — it recycles kaval, not
   *  itself). */
  capturedPadiPid?: number;
  capturedKavalPid?: number;
  savedWorkspaceSwitcherCount?: number;
  /** Code-tab preview (diff-content) pane height captured by `I note the
   *  Code tab preview pane height`, compared after terminal switches to
   *  prove the tree/content split fraction survives. */
  savedCodeTabPreviewHeight?: number;
  savedActiveTerminalId?: string;
  /** Which host tab was selected before the conductor was entered, so the
   *  `⌘⇧O` round trip can prove it lands back on exactly that tab — the
   *  conversation is not a host, and selecting it must not have moved which
   *  host is active. */
  notedHostKey?: string;
  /** The terminal id the conductor was asked to adopt, so the step that
   *  presses the tool card's *open tile* can assert the focus landed on THAT
   *  terminal rather than on whichever tile happened to be active. */
  adoptedTerminalId?: string;
  /** The account the Conductor's agent said it was signed in as, noted before
   *  a sign-in, so the step after it can tell the account really moved. */
  notedAccount?: string;
  /** The terminal id the conductor was asked to WATCH — the one it adopted
   *  into a work — so a wake, the work card's member row and its Look can each
   *  be checked against THAT terminal. */
  watchedTerminalId?: string;
  /** The piece of work the scenario opened, as the card's own `data-work`.
   *  Read off the card rather than parsed out of prose: the id is the client's
   *  own reading of the record, so every later step is about the same work the
   *  person is looking at. */
  workId?: string;
  /** The title the scenario gave that work, which is what the dock row's mark
   *  and the card's head read out. */
  workTitle?: string;
  /** The work id the conductor answered with the SECOND time it was asked to
   *  open the same branch — the idempotent-open claim, read from the agent's
   *  own answer rather than from the column, so the assertion is about what
   *  `work_open` returned and not merely about what is drawn. */
  workIdAgain?: string;
  /** The git repo the work is done in — a scratch worktree this scenario made.
   *  Its `.waterfall/` files, its branch and its stated pull request are what
   *  kolu observes the work through. */
  workRepoDir?: string;
  /** Where the conductor transcript was scrolled when a scenario noted it —
   *  the pixel a pick on the works side must not move. */
  notedTranscriptTop?: number;
  /** The composer box's height with one short line in it, so a long message
   *  can be shown to have grown it. */
  notedComposerHeight?: number;
  /** The member terminal the conductor created with a role, and the transcript
   *  path of the stand-in agent running in it: the scenario moves that agent
   *  between states to produce the level changes kolu records as events. */
  memberTerminalId?: string;
  memberTranscriptPath?: string;
  peekNotedSize?: string;
  peekBar?: { x: number; y: number; width: number };
  peekGrid?: string;
  /** A terminal's shell pid, read while it still had the keyboard, so an
   *  agent can be staged in it after the scenario has moved elsewhere. */
  notedShellPid?: number;
  /** Everything the page's console said from the conductor paste onwards. A
   *  prompt refused before any row exists (an attachment this agent was never
   *  told it could take) leaves nothing in the transcript, so the console is
   *  the only place the refusal's own sentence survives for the failure
   *  message. */
  conductorConsole?: string[];
  /** A value written onto the conductor pane's DOM NODE (a JS expando, not an
   *  attribute) before leaving for a host tab. The pane is mounted once and
   *  retained, so finding the same value on the node afterwards is proof the
   *  element itself survived the round trip — a rebuilt pane comes back
   *  without it, however identical it looks. */
  conductorPaneMarker?: string;
  savedScrollTop?: number;
  /** Maximized-dock width (px) captured before a resize drag, so a follow-up
   *  step can prove the drag widened it and that the width survives a reload. */
  savedDockWidth?: number;
  /** The PERSISTED `kolu-dock-cards-width` value (distinct from the rendered
   *  `savedDockWidth` above) captured before a resize drag that gets cancelled.
   *  A cancelled drag never writes to storage (only a completed drag commits),
   *  so this is `null` whenever no earlier drag in the test has persisted a
   *  value yet — the cancel step compares against THIS, not a hardcoded
   *  non-null expectation. */
  savedStoredDockWidth?: number | null;
  savedVisibleText?: string;
  /** The last draft typed into the Inspector's Compose box, so a follow-up
   *  step can assert it reached the terminal. */
  composedDraft?: string;
  snapshotCols?: Record<string, number>;
  /** The terminal a stand-in full-screen program is drawing in
   *  (`terminal_lockstep_steps.ts`), so every later step compares the SAME
   *  terminal's two screens — the pane's and the daemon's — however focus and
   *  the split have moved since. */
  paintedTerminalId?: string;
  /** Snapshot of `data-zoom` from `before I zoom the canvas in` so the
   *  follow-up `Then the canvas zoom level should have changed` step can
   *  compare. */
  zoomBefore?: number;
  /** Per-terminal grid dimensions captured by `When I snapshot the terminal
   *  grid`, so a follow-up step can prove page magnification did NOT refit the
   *  terminals. */
  savedTerminalGrid?: Record<string, { cols: number; rows: number }>;
  /** Snapshot of zoom + transform attributes captured by the
   *  `When I save the canvas viewport state` step. */
  savedViewportState?: {
    zoom: string | null;
    transform: string | null;
  } | null;
  /** Map of tile-index → tile geometry captured by `When I save canvas
   *  tile {int} position`, read back by minimap-drag and position-changed
   *  steps. */
  savedCanvasTilePositions?: Record<
    number,
    { id: string; left: number; top: number }
  >;
  /** Snapshot of every visible canvas tile's canvas-space position
   *  (`style.left`/`top`, keyed by terminal id) captured by `When I
   *  record all canvas tile positions`. Read back by the
   *  no-auto-arrange-on-create regression to prove a new terminal never
   *  moves an existing one. */
  recordedTilePositions?: Record<string, { left: number; top: number }>;
  _scrollFifo?: string;
  /** The popup page captured when an external link inside the sandboxed
   *  HTML preview is clicked — the in-iframe SDK forwards the URL to the
   *  parent, which opens it in a new browser tab (a fresh context page). */
  externalPopup?: Page;
  /** The URL a port forward answered on — recorded when the forwarded tab loads,
   *  so the cancel scenario can prove the door is SHUT (from node, against the
   *  socket) rather than merely unlisted in the UI. */
  forwardedUrl?: string;
  createdTerminalIds: string[] = [];

  /** The row-ids a cluster step has `I snapshot...`d, keyed by cluster label —
   *  surface for asserting a drag reorders CARRIERS (clusters/sections), never
   *  the rows inside one. */
  savedClusterRows: Map<string, string[]> = new Map();
  shuffleHistory: string[] = [];
  /** A sub-terminal (split) id captured by the deep-links steps, so a
   *  `#/t/local/<subId>` link can target it after focus has moved away. */
  rememberedSubTerminalId: string | null = null;
  /** Canvas tile count snapshotted by the dock re-home steps, so a re-home is
   *  asserted as a DELTA. The scenario's own background terminal is a tile too,
   *  so an absolute count would silently depend on it. */
  canvasTileCount: number | null = null;
  /** `history.length` snapshot taken by the deep-links steps, so a scenario can
   *  pin that routing deep links pushes NO history entries (mouse-back must
   *  never replay a stale teleport). */
  pageHistoryLength: number | null = null;

  /** Wait for a double-rAF — ensures SolidJS reactivity + Corvu transitions have been flushed. */
  async waitForFrame() {
    await this.page.evaluate(
      () =>
        new Promise<void>((resolve) =>
          requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
        ),
    );
  }

  get canvas(): Locator {
    // The focused tile is the one user input lands in. With multiple
    // visible canvas tiles, `[data-focused]` resolves to the single tile
    // that owns keyboard focus — clicking + asserting on the active
    // terminal lines up with what the user sees.
    return this.page.locator("[data-focused] .xterm-screen").first();
  }

  /** Create a terminal via the keyboard shortcut (`Cmd/Super+Enter`). Works
   *  uniformly on desktop and mobile — there is no longer a "+" button on
   *  any surface; the shortcut and the command palette are the only paths.
   *  Returns the new terminal's ID. */
  async createTerminal(timeout = READY_TIMEOUT): Promise<string> {
    // IS THE WORKSPACE COVERED? The Conductor is a full-window layer over the
    // host's canvas, and a tile the user has never seen is never shown: a
    // terminal created from here mounts UNSEEN and leaves the keyboard where
    // it was (kolu#2362). (Tiles that WERE on screen when the conversation
    // covered them keep their feed for the grace period — but a brand new
    // one has nothing to hold.) So there is no visible screen to wait for,
    // and waiting for one is waiting for something the product deliberately
    // does not do.
    const covered = await this.page
      .locator('[data-testid="conductor-pane"]')
      .isVisible();

    // Wait for app to settle (onMount may still be restoring terminals from server)
    if (!covered) {
      const settled = this.page.locator(SETTLED_SELECTOR);
      await settled.first().waitFor({ state: "visible", timeout });
    }

    // Snapshot known ids before the shortcut fires.
    const beforeIds = await this.terminalIds();

    await this.page.keyboard.press(`${APP_KEY}+Enter`);

    // Poll until a new id shows up, and return that exact observation. Reading
    // the ids again after the poll is a check/use race: the mobile empty-state
    // → tile transition can briefly unmount every `data-terminal-id` node
    // between the two browser evaluations even though creation succeeded.
    const newIdHandle = await this.page.waitForFunction(
      (prev) => {
        const nodes = Array.from(
          document.querySelectorAll("[data-terminal-id]"),
        );
        const ids = new Set(
          nodes
            .map((n) => n.getAttribute("data-terminal-id"))
            .filter((id): id is string => !!id),
        );
        for (const id of ids) {
          if (!prev.includes(id)) return id;
        }
        return null;
      },
      beforeIds,
      { timeout },
    );
    const newId = await newIdHandle.jsonValue();
    await newIdHandle.dispose();
    if (newId === null)
      throw new Error("Terminal ID poll resolved without an ID");

    if (covered) {
      // What IS owed: the terminal's own body is mounted behind the
      // Conductor, so it is there to be shown the moment the user goes back
      // to the host tab. (`data-font-size` is this suite's spelling for the
      // inner terminal container — see `support/buffer.ts`.)
      await this.page
        .locator(`[data-terminal-id="${newId}"][data-font-size]`)
        .first()
        .waitFor({ state: "attached", timeout });
      return newId;
    }

    await this.canvas.waitFor({ state: "visible", timeout });
    // Desktop auto-focuses xterm's textarea on mount — the signal that a
    // subsequent keyboard.type() will land — so wait for it. On touch, selection
    // no longer auto-focuses (focusOnSelection() is a no-op there; the soft keyboard
    // must only rise on an explicit tap), so the terminal mounts unfocused by
    // design — gate on the helper textarea existing in the visible tile instead.
    await this.page.waitForFunction(
      (coarsePointer) => {
        const visible = document.querySelector("[data-visible]");
        if (!visible) return false;
        return matchMedia(coarsePointer).matches
          ? !!visible.querySelector(".xterm-helper-textarea")
          : !!document.activeElement?.closest("[data-visible]");
      },
      COARSE_POINTER_QUERY,
      { timeout },
    );
    return newId;
  }

  /** All terminal ids currently present in the DOM (canvas tiles, mobile
   *  pager entries, and workspace-switcher entries all carry `data-terminal-id`). */
  async terminalIds(): Promise<string[]> {
    return this.page.evaluate(() => {
      const seen = new Set<string>();
      for (const n of document.querySelectorAll("[data-terminal-id]")) {
        const id = n.getAttribute("data-terminal-id");
        if (id) seen.add(id);
      }
      return [...seen];
    });
  }

  /** Wait for the app to reach a stable state (restored terminals or
   *  empty state).
   *
   *  Pass `onTick` to drive a side effect (re-POST, `utimesSync` re-touch,
   *  WAL nudge) on every poll iteration — the same self-heal pattern that
   *  `pollFor` in `support/poll.ts` exposes. Used by step definitions that
   *  race a server-side hydration effect against test fixtures (see
   *  `session_restore_steps.ts`). */
  async waitForSettled(
    timeout = READY_TIMEOUT,
    onTick?: () => void | Promise<void>,
  ) {
    const settled = this.page.locator(SETTLED_SELECTOR);
    if (!onTick) {
      await settled.first().waitFor({ state: "visible", timeout });
      return;
    }
    const deadline = Date.now() + timeout;
    while (Date.now() < deadline) {
      if (
        await settled
          .first()
          .isVisible()
          .catch(() => false)
      )
        return;
      await onTick();
      await new Promise((r) => setTimeout(r, 250));
    }
    await settled.first().waitFor({ state: "visible", timeout: 500 });
  }

  /** Wait for the app to settle, creating a terminal if empty state is shown. */
  async waitForReady(timeout = READY_TIMEOUT) {
    await this.waitForSettled(timeout);

    // If the empty state is visible, create a terminal
    if (await this.page.locator('[data-testid="empty-state"]').isVisible()) {
      await this.createTerminal(timeout);
    }
  }

  /** Ensure a terminal matching `scope` holds keyboard focus before typing.
   *  On touch, terminals no longer auto-focus on selection (the soft keyboard
   *  must rise only on a tap), so this focuses the target's helper textarea —
   *  the harness stand-in for that tap. Desktop terminals already hold focus,
   *  so it no-ops there. */
  async focusForTyping(scope: string) {
    const focused = await this.page.evaluate(
      (sel) => !!document.activeElement?.closest(sel),
      scope,
    );
    if (!focused) {
      await this.page
        .locator(`${scope} .xterm-helper-textarea`)
        .first()
        .focus();
    }
  }

  async terminalRun(command: string) {
    await this.focusForTyping("[data-visible]:not([data-sub-terminal])");
    await this.page.keyboard.type(command);
    await this.page.keyboard.press("Enter");
  }

  async terminalRunAndWait(command: string) {
    await this.focusForTyping("[data-visible]:not([data-sub-terminal])");
    const sequence = terminalCommandSequence++;
    const token = `KD_${process.pid}_${sequence}`;
    const marker = `${token}:`;
    await this.page.keyboard.type(
      `{ ${command}; }; kolu_status=$?; ` +
        `printf '\\nK''D_${process.pid}_${sequence}:%s\\n' "$kolu_status"`,
    );
    await this.page.keyboard.press("Enter");

    const handle = await this.page.waitForFunction(
      ({ expected }) => {
        const content =
          window.__readXtermBuffer?.("[data-focused][data-terminal-id]", 0) ??
          "";
        return content.includes(expected) ? content : null;
      },
      { expected: marker },
      { timeout: HYDRATION_TIMEOUT, polling: 50 },
    );
    const buffer = (await handle.jsonValue()) ?? "";
    const status = buffer.match(new RegExp(`${marker}(\\d+)`))?.[1];
    if (status !== "0") {
      // The numeric shell status identifies only a broad failure class (Git,
      // for example, uses 128 for many unrelated fatal errors). Preserve a
      // bounded tail ending at our marker so CI records the command's actual
      // diagnostic without dumping an entire scenario's terminal scrollback.
      const markerOffset = buffer.lastIndexOf(marker);
      const diagnosticEnd =
        markerOffset === -1 ? buffer.length : markerOffset + marker.length + 3;
      const diagnostic = buffer.slice(
        Math.max(0, diagnosticEnd - 2_000),
        diagnosticEnd,
      );
      throw new Error(
        `terminal command failed${status ? ` with status ${status}` : ""}: ${command}` +
          `\nTerminal buffer tail:\n${diagnostic}`,
      );
    }
  }

  async canvasBox() {
    const box = await this.canvas.boundingBox();
    if (!box) throw new Error("Canvas has no bounding box");
    return box;
  }

  async containerBox() {
    const box = await this.page
      .locator("[data-visible][data-font-size]")
      .boundingBox();
    if (!box) throw new Error("Container has no bounding box");
    return box;
  }

  async resizeViewport(width: number, height: number) {
    await this.page.setViewportSize({ width, height });
    // Wait for layout reflow and xterm.js fit to settle
    await this.waitForFrame();
    await this.waitForFrame();
  }

  async zoomIn() {
    await this.page.keyboard.press(`${MOD_KEY}+Equal`);
    await this.waitForFrame();
  }

  async zoomOut() {
    await this.page.keyboard.press(`${MOD_KEY}+Minus`);
    await this.waitForFrame();
  }

  async fontSize(): Promise<number> {
    const val = await this.page
      .locator("[data-visible][data-font-size]")
      .getAttribute("data-font-size");
    if (!val) throw new Error("No data-font-size attribute found");
    return parseFloat(val);
  }
}

setWorldConstructor(KoluWorld);
