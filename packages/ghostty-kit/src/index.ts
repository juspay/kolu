/** `@kolu/ghostty-kit` — official libghostty-vt wasm as the VT engine.
 *
 *  Runtime-neutral: no solid-js, no DOM. This barrel is the Node/kaval
 *  entry — it reads the vendored wasm from disk. The Solid canvas tile
 *  lives behind `@kolu/ghostty-kit/solid` and fetches the same files. */

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { setVendorReader } from "./load.ts";

function readVendor(name: string): Uint8Array {
  const url = new URL(`../vendor/${name}`, import.meta.url);
  try {
    return new Uint8Array(readFileSync(fileURLToPath(url)));
  } catch (err) {
    throw new Error(
      `@kolu/ghostty-kit: official ${name} is missing at ${url.pathname} — ${err instanceof Error ? err.message : String(err)}`,
    );
  }
}

setVendorReader(() => ({
  vt: readVendor("ghostty-vt.wasm"),
  trampoline: readVendor("trampoline.wasm"),
}));

export { createEngine } from "./engine.ts";
export type { Engine, EngineOptions, ScreenExtent } from "./engine.ts";
export { loadGhostty } from "./load.ts";
export { GhosttyError } from "./ffi.ts";
export { encodeKey, encodeMouse } from "./encode.ts";
export type { KeyEvent, MouseEvent } from "./encode.ts";
