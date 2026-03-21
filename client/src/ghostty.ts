/**
 * Pure wrapper around ghostty-web WASM terminal emulator.
 *
 * Low volatility — only changes when ghostty-web API changes.
 * Dynamically imported to avoid blocking initial page load.
 */

import type { Terminal, ITerminalOptions } from "ghostty-web";
import { THEME } from "./theme";

const FONT_FAMILY = '"FiraCode Nerd Font", monospace';

// Dynamic import shape (ghostty-web exports these at runtime)
interface GhosttyModule {
  init(): Promise<void>;
  Terminal: new (opts?: ITerminalOptions) => Terminal;
}

let initPromise: Promise<GhosttyModule> | null = null;

/** Initialize ghostty-web WASM. Idempotent and race-safe. */
export function initGhostty(): Promise<GhosttyModule> {
  return (initPromise ??= (async () => {
    const mod = (await import("ghostty-web")) as unknown as GhosttyModule;
    await mod.init();
    return mod;
  })());
}

/** Create a new terminal instance from an initialized module. */
export function createTerminal(
  mod: GhosttyModule,
  fontSize?: number,
): Terminal {
  return new mod.Terminal({ fontSize, fontFamily: FONT_FAMILY, theme: THEME });
}

/** Measure cell dimensions from canvas size and known grid dimensions. */
export function measureCells(el: HTMLElement, cols: number, rows: number) {
  const canvas = el.querySelector("canvas");
  if (!canvas) throw new Error("No canvas found in terminal element");
  const { width, height } = canvas.getBoundingClientRect();
  return { cellWidth: width / cols, cellHeight: height / rows };
}

/** Calculate cols/rows to fill a container given cell dimensions. */
export function fitToContainer(
  container: HTMLElement,
  cellWidth: number,
  cellHeight: number,
) {
  const { width, height } = container.getBoundingClientRect();
  return {
    cols: Math.floor(width / cellWidth),
    rows: Math.floor(height / cellHeight),
  };
}

export type { Terminal };
