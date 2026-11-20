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
import "kolu-common/test-hooks";

export const POLL_TIMEOUT = 20_000;

export const GRID_ROUND_TRIP_MS = 3_000;

export const HYDRATION_TIMEOUT = 60_000;

const READY_TIMEOUT = HYDRATION_TIMEOUT;

const STEP_GUARD = 10_000;
setDefaultTimeout(Math.max(POLL_TIMEOUT, HYDRATION_TIMEOUT) + STEP_GUARD);
export const MOD_KEY = process.platform === "darwin" ? "Meta" : "Control";

export const APP_KEY = "Meta";

const SETTLED_SELECTOR =
  '[data-visible] .xterm-screen, [data-testid="dormant-tile-body"], [data-testid="empty-state"], [data-testid="conductor-pane"]';
export const COARSE_POINTER_QUERY = "(pointer: coarse)";
export const DOCK_ROW_SELECTOR = '[data-testid="dock-row"]';
export const CANVAS_TILE_SELECTOR = '[data-testid="canvas-tile"]';
export const ACTIVE_CANVAS_TILE_SELECTOR = `${CANVAS_TILE_SELECTOR}[data-active]`;

let terminalCommandSequence = 0;

export class KoluWorld extends World {
  browser!: Browser;
  context!: BrowserContext;
  page!: Page;
  errors: string[] = [];

  savedSessionTerminalCount?: number;
  savedSessionTerminals?: import("kolu-common").SavedTerminal[];
  savedSessionSavedAt?: number;
  savedSessionActiveId?: string;
  savedCanvas?: { x: number; y: number; width: number; height: number };
  previousCanvas?: { x: number; y: number; width: number; height: number };
  savedFontSize?: number;
  savedTerminalZoom?: {
    sizes: Record<string, number>;
    focusedId: string | null;
  };
  lastResponseText?: string;
  lastResponseOk?: boolean;
  lastDownload?: Download;
  terminalCountBeforeRefresh?: number;
  capturedPadiPid?: number;
  capturedKavalPid?: number;
  savedWorkspaceSwitcherCount?: number;
  savedCodeTabPreviewHeight?: number;
  savedActiveTerminalId?: string;
  notedHostKey?: string;
  adoptedTerminalId?: string;
  notedAccount?: string;
  watchedTerminalId?: string;
  workId?: string;
  workTitle?: string;
  workIdAgain?: string;
  workRepoDir?: string;
  memberTerminalId?: string;
  memberTranscriptPath?: string;
  notedShellPid?: number;
  conductorConsole?: string[];
  conductorPaneMarker?: string;
  savedScrollTop?: number;
  savedDockWidth?: number;
  savedStoredDockWidth?: number | null;
  savedVisibleText?: string;
  composedDraft?: string;
  snapshotCols?: Record<string, number>;
  paintedTerminalId?: string;
  zoomBefore?: number;
  savedTerminalGrid?: Record<string, { cols: number; rows: number }>;
  savedViewportState?: {
    zoom: string | null;
    transform: string | null;
  } | null;
  savedCanvasTilePositions?: Record<
    number,
    { id: string; left: number; top: number }
  >;
  recordedTilePositions?: Record<string, { left: number; top: number }>;
  _scrollFifo?: string;
  externalPopup?: Page;
  forwardedUrl?: string;
  createdTerminalIds: string[] = [];

  savedClusterRows: Map<string, string[]> = new Map();
  shuffleHistory: string[] = [];
  rememberedSubTerminalId: string | null = null;
  canvasTileCount: number | null = null;
  pageHistoryLength: number | null = null;

  async waitForFrame() {
    await this.page.evaluate(
      () =>
        new Promise<void>((resolve) =>
          requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
        ),
    );
  }

  get canvas(): Locator {
    return this.page.locator("[data-focused] .xterm-screen").first();
  }

  async createTerminal(timeout = READY_TIMEOUT): Promise<string> {
    const covered = await this.page
      .locator('[data-testid="conductor-pane"]')
      .isVisible();

    if (!covered) {
      const settled = this.page.locator(SETTLED_SELECTOR);
      await settled.first().waitFor({ state: "visible", timeout });
    }

    const beforeIds = await this.terminalIds();

    await this.page.keyboard.press(`${APP_KEY}+Enter`);

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
      await this.page
        .locator(`[data-terminal-id="${newId}"][data-font-size]`)
        .first()
        .waitFor({ state: "attached", timeout });
      return newId;
    }

    await this.canvas.waitFor({ state: "visible", timeout });
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

  async waitForReady(timeout = READY_TIMEOUT) {
    await this.waitForSettled(timeout);

    if (await this.page.locator('[data-testid="empty-state"]').isVisible()) {
      await this.createTerminal(timeout);
    }
  }

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
