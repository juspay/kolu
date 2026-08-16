/** Key / mouse encode through the official wasm (no hand-rolled CSI). */

import { check, Ffi } from "./ffi.ts";
import { loadGhostty } from "./load.ts";

export interface KeyEvent {
  /** Ghostty key enum integer. 0 = unspecified (utf8-only). */
  key?: number;
  /** 1 = press, 2 = repeat, 3 = release. */
  action?: number;
  mods?: number;
  utf8?: string;
}

export interface MouseEvent {
  action: number;
  button?: number;
  mods?: number;
  x: number;
  y: number;
}

export function encodeKey(term: number | null, event: KeyEvent): Uint8Array {
  const wasm = loadGhostty();
  const ffi = new Ffi(wasm);
  const encOut = ffi.allocOpaque();
  check("key_encoder_new", wasm.exports.ghostty_key_encoder_new(0, encOut));
  const enc = ffi.u32(encOut);
  try {
    if (term) {
      wasm.exports.ghostty_key_encoder_setopt_from_terminal(enc, term);
    }
    const evOut = ffi.allocOpaque();
    check("key_event_new", wasm.exports.ghostty_key_event_new(0, evOut));
    const ev = ffi.u32(evOut);
    try {
      if (event.action !== undefined)
        wasm.exports.ghostty_key_event_set_action(ev, event.action);
      if (event.key !== undefined)
        wasm.exports.ghostty_key_event_set_key(ev, event.key);
      if (event.mods !== undefined)
        wasm.exports.ghostty_key_event_set_mods(ev, event.mods);
      if (event.utf8 !== undefined) {
        const bytes = new TextEncoder().encode(event.utf8);
        const ptr = ffi.writeBytes(bytes);
        wasm.exports.ghostty_key_event_set_utf8(ev, ptr, bytes.length);
        ffi.freeBytes(ptr, bytes.length);
      }
      const cap = 64;
      const buf = ffi.allocBytes(cap);
      const written = ffi.allocUsize();
      check(
        "key_encode",
        wasm.exports.ghostty_key_encoder_encode(enc, ev, buf, cap, written),
      );
      return ffi.readBytes(buf, ffi.u32(written));
    } finally {
      wasm.exports.ghostty_key_event_free(ev);
    }
  } finally {
    wasm.exports.ghostty_key_encoder_free(enc);
  }
}

export function encodeMouse(event: MouseEvent): Uint8Array {
  const wasm = loadGhostty();
  const ffi = new Ffi(wasm);
  const encOut = ffi.allocOpaque();
  check("mouse_encoder_new", wasm.exports.ghostty_mouse_encoder_new(0, encOut));
  const enc = ffi.u32(encOut);
  const evOut = ffi.allocOpaque();
  check("mouse_event_new", wasm.exports.ghostty_mouse_event_new(0, evOut));
  const ev = ffi.u32(evOut);
  try {
    wasm.exports.ghostty_mouse_event_set_action(ev, event.action);
    if (event.button !== undefined)
      wasm.exports.ghostty_mouse_event_set_button(ev, event.button);
    if (event.mods !== undefined)
      wasm.exports.ghostty_mouse_event_set_mods(ev, event.mods);
    wasm.exports.ghostty_mouse_event_set_position(ev, event.x, event.y);
    const cap = 64;
    const buf = ffi.allocBytes(cap);
    const written = ffi.allocUsize();
    check(
      "mouse_encode",
      wasm.exports.ghostty_mouse_encoder_encode(enc, ev, buf, cap, written),
    );
    return ffi.readBytes(buf, ffi.u32(written));
  } finally {
    wasm.exports.ghostty_mouse_event_free(ev);
    wasm.exports.ghostty_mouse_encoder_free(enc);
  }
}
