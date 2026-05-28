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

/** Locator for the app's settled state: either a visible terminal screen or the empty state tip. */
const SETTLED_SELECTOR =
  '[data-visible] .xterm-screen, [data-testid="empty-state"]';
/** Touch-device media query — mirrors `isTouch` in packages/client/src/useMobile.ts.
 *  The test package can't import from client src, so the literal is named here to
 *  keep the one place it's duplicated legible and self-documenting. */
const COARSE_POINTER_QUERY = "(pointer: coarse)";
/** Canonical "list of terminals" affordance — one row per terminal in
 *  the dock. Replaced the chrome-bar workspace-switcher pill
 *  strip with #903; the surface is different, the semantics are the
 *  same (one entry per live terminal with `data-terminal-id`,
 *  `data-active`, `data-unread`, etc.). */
export const WORKSPACE_SWITCHER_ENTRY_SELECTOR = '[data-testid="dock-row"]';
/** Per-tile elements on the canvas — one per top-level terminal. Mobile
 *  uses the mobile-tile-view body to enumerate terminals instead. */
export const CANVAS_TILE_SELECTOR = '[data-testid="canvas-tile"]';

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
  savedCanvas?: { x: number; y: number; width: number; height: number };
  previousCanvas?: { x: number; y: number; width: number; height: number };
  savedFontSize?: number;
  lastResponseText?: string;
  lastResponseOk?: boolean;
  terminalCountBeforeRefresh?: number;
  savedWorkspaceSwitcherCount?: number;
  savedActiveTerminalId?: string;
  savedScrollTop?: number;
  savedVisibleText?: string;
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
  _scrollFifo?: string;
  createdTerminalIds: string[] = [];
  shuffleHistory: string[] = [];

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

    // Poll until a new id shows up.
    await this.page.waitForFunction(
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
          if (!prev.includes(id)) return true;
        }
        return false;
      },
      beforeIds,
      { timeout },
    );

    const afterIds = await this.terminalIds();
    const newId = afterIds.find((id) => !beforeIds.includes(id));
    if (!newId) throw new Error("Created terminal but no new id appeared");

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
