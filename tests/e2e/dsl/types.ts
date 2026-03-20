/**
 * E2E test DSL types for kolu.
 *
 * Defines the contract for high-level test interactions.
 * Implementation lives in terminal.ts; tests import only types + scenario().
 */

import type { Page, Locator } from '@playwright/test';

/** Terminal view — wraps all interactions with the ghostty-web canvas. */
export interface TerminalView {
  /** The raw canvas locator (for low-level assertions). */
  canvas: Locator;

  /** Wait for terminal to be ready (canvas visible + WS connected). */
  waitForReady(opts?: { timeout?: number }): Promise<void>;

  /** Type text into the terminal (raw keyboard events). */
  type(text: string): Promise<void>;

  /** Send Enter key. */
  enter(): Promise<void>;

  /** Type a command and press Enter. */
  run(command: string): Promise<void>;

  /** Get canvas bounding box dimensions. */
  boundingBox(): Promise<{ x: number; y: number; width: number; height: number }>;

  /** Resize the browser viewport and wait for reflow. */
  resizeViewport(width: number, height: number): Promise<void>;

  /** Send Cmd/Ctrl+= to zoom in. */
  zoomIn(): Promise<void>;

  /** Send Cmd/Ctrl+- to zoom out. */
  zoomOut(): Promise<void>;

  /** Read the current font size from the terminal's data attribute. */
  fontSize(): Promise<number>;

  /** Get the terminal container's bounding box (the parent div, not the canvas). */
  containerBox(): Promise<{ x: number; y: number; width: number; height: number }>;
}

/** App-level view — wraps the full page (header + terminal). */
export interface AppView {
  page: Page;
  terminal: TerminalView;

  /** WebSocket status text shown in the header. */
  wsStatus(): Promise<string>;

  /** Page errors collected since navigation. */
  errors: string[];
}

/** Options passed to scenario(). */
export interface ScenarioOptions {
  /** Override default test timeout (ms). */
  timeout?: number;
}

/** Context passed to the scenario body function. */
export interface ScenarioContext {
  app: AppView;
}
