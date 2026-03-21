/**
 * ghostty-web WASM initialization.
 *
 * Low volatility — only changes when ghostty-web API changes.
 * Dynamic import() keeps the 413KB WASM out of the initial bundle,
 * so the app shell renders before the terminal loads.
 */

import type { Terminal, ITerminalOptions } from "ghostty-web";

// Dynamic import shape (ghostty-web exports these at runtime)
export interface GhosttyModule {
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

export type { Terminal };
