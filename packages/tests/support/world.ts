/**
 * Cucumber World — holds Playwright page + terminal helpers.
 * One instance per scenario. Browser context created in hooks.ts.
 */

import {
  setDefaultTimeout,
  setWorldConstructor,
  World,
} from "@cucumber/cucumber";
import type { Browser, BrowserContext, Locator, Page } from "playwright";
// Side-effect import: pulls in the `Window`/`HTMLDivElement`/`Navigator`
// augmentations every step definition needs (window.__readXtermBuffer,
// `__xterm` on tile divs, the Badging API stubs, …) so tests can read
// them without `(window as any)` / `(this as any)` casts.
import "kolu-common/test-hooks";

/** Per-step / per-hook budget for interaction polls — `waitFor` /
 *  `waitForFunction` against a settled UI. Most step definitions reach
 *  for this. */
export const POLL_TIMEOUT = 20_000;

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

/** Locator for the app's settled state: a visible terminal screen, a dormant
 *  (sleeping) tile body, or the empty state tip. A canvas holding only sleeping
 *  tiles is fully settled — its tiles render a PTY-less `dormant-tile-body` (no
 *  `[data-terminal-screen]`), and it is NOT the empty state — so the dormant body is the
 *  third settled shape a reload/converge can land on. */
const SETTLED_SELECTOR =
  '[data-visible] [data-terminal-screen], [data-testid="dormant-tile-body"], [data-testid="empty-state"]';
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
  /** Snapshot of `data-zoom` from `before I zoom the canvas in` so the
   *  follow-up `Then the canvas zoom level should have changed` step can
   *  compare. */
  zoomBefore?: number;
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
  shuffleHistory: string[] = [];
  /** A sub-terminal (split) id captured by the deep-links steps, so a
   *  `#/t/local/<subId>` link can target it after focus has moved away. */
  rememberedSubTerminalId: string | null = null;
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
    return this.page.locator("[data-focused] [data-terminal-screen]").first();
  }

  /** Create a terminal via the keyboard shortcut (`Cmd/Ctrl+Enter`). Works
   *  uniformly on desktop and mobile — there is no longer a "+" button on
   *  any surface; the shortcut and the command palette are the only paths.
   *  Returns the new terminal's ID. */
  async createTerminal(timeout = READY_TIMEOUT): Promise<string> {
    // Wait for app to settle (onMount may still be restoring terminals from server)
    const settled = this.page.locator(SETTLED_SELECTOR);
    await settled.first().waitFor({ state: "visible", timeout });

    // Snapshot known ids before the shortcut fires.
    const beforeIds = await this.terminalIds();

    await this.page.keyboard.press(`${MOD_KEY}+Enter`);

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
          ? !!visible.querySelector("[data-terminal-input]")
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
    const input = this.page.locator(`${scope} [data-terminal-input]`).first();
    await input.waitFor({ state: "attached", timeout: READY_TIMEOUT });
    const focused = await this.page.evaluate(
      (sel) => !!document.activeElement?.closest(sel),
      scope,
    );
    if (!focused) {
      await input.focus();
    }
  }

  /** Main pane of the active tile. `data-focused` can sit on a split, so
   *  I-run must not require the main to already hold keyboard focus. */
  private async focusMainForRun(): Promise<string> {
    const tileMain =
      "[data-canvas-tile][data-active] [data-terminal-id]:not([data-sub-terminal])";
    const fallback = "[data-visible]:not([data-sub-terminal])";
    const scope =
      (await this.page.locator(tileMain).count()) > 0 ? tileMain : fallback;
    const screen = this.page.locator(`${scope} [data-terminal-screen]`).first();
    await screen.waitFor({ state: "attached", timeout: READY_TIMEOUT });
    // Click, don't textarea.focus(): provenance ignores programmatic focus,
    // so the store (and data-focused) would stay on a split.
    // No waitForFrame — render-recovery parks rAF, and a frame wait hangs.
    await screen.click({ force: true });
    return scope;
  }

  async terminalRun(command: string) {
    await this.focusMainForRun();
    await this.page.keyboard.type(command);
    await this.page.keyboard.press("Enter");
  }

  async terminalRunAndWait(command: string) {
    const scope = await this.focusMainForRun();
    const sequence = terminalCommandSequence++;
    const token = `KD_${process.pid}_${sequence}`;
    const marker = `${token}:`;
    await this.page.keyboard.type(
      `{ ${command}; }; kolu_status=$?; ` +
        `printf '\\nK''D_${process.pid}_${sequence}:%s\\n' "$kolu_status"`,
    );
    await this.page.keyboard.press("Enter");

    const handle = await this.page.waitForFunction(
      ({ expected, sel }) => {
        const content = window.__readXtermBuffer?.(sel, 0) ?? "";
        return content.includes(expected) ? content : null;
      },
      { expected: marker, sel: scope },
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
