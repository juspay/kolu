/** `@kolu/ghostty-kit` — official libghostty-vt wasm as the VT engine.
 *
 *  Runtime-neutral: no solid-js, no DOM. Node (kaval) and the browser both
 *  call {@link createEngine}. The Solid canvas tile lives behind
 *  `@kolu/ghostty-kit/solid`. */

export { createEngine } from "./engine.ts";
export type { Engine, EngineOptions, ScreenExtent } from "./engine.ts";
export { loadGhostty } from "./load.ts";
export { GhosttyError } from "./ffi.ts";
export { encodeKey, encodeMouse } from "./encode.ts";
export type { KeyEvent, MouseEvent } from "./encode.ts";
