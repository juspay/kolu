/** Load the official `ghostty-vt.wasm` once. Throws if the asset is missing. */

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

export interface GhosttyExports {
  memory: WebAssembly.Memory;
  __indirect_function_table: WebAssembly.Table;
  ghostty_type_json: () => number;
  ghostty_wasm_alloc_opaque: () => number;
  ghostty_wasm_free_opaque: (ptr: number) => void;
  ghostty_wasm_alloc_u8_array: (len: number) => number;
  ghostty_wasm_free_u8_array: (ptr: number, len: number) => void;
  ghostty_wasm_alloc_u8: () => number;
  ghostty_wasm_free_u8: (ptr: number) => void;
  ghostty_wasm_alloc_usize: () => number;
  ghostty_wasm_free_usize: (ptr: number) => void;
  ghostty_free: (allocator: number, ptr: number, len: number) => void;
  ghostty_terminal_new: (
    allocator: number,
    out: number,
    cols: number,
    rows: number,
  ) => number;
  ghostty_terminal_free: (term: number) => void;
  ghostty_terminal_reset: (term: number) => void;
  ghostty_terminal_resize: (
    term: number,
    cols: number,
    rows: number,
    cellW: number,
    cellH: number,
  ) => number;
  ghostty_terminal_set: (term: number, option: number, value: number) => number;
  ghostty_terminal_vt_write: (term: number, data: number, len: number) => void;
  ghostty_terminal_get: (term: number, data: number, out: number) => number;
  ghostty_formatter_terminal_new: (
    allocator: number,
    out: number,
    term: number,
    options: number,
  ) => number;
  ghostty_formatter_format_alloc: (
    formatter: number,
    allocator: number,
    outPtr: number,
    outLen: number,
  ) => number;
  ghostty_formatter_free: (formatter: number) => void;
  ghostty_snapshot_encode_alloc: (
    term: number,
    allocator: number,
    outPtr: number,
    outLen: number,
  ) => number;
  ghostty_snapshot_decoder_new_buf: (
    allocator: number,
    out: number,
    ptr: number,
    len: number,
  ) => number;
  ghostty_snapshot_decoder_decode: (decoder: number, out: number) => number;
  ghostty_snapshot_decoder_free: (decoder: number) => void;
  ghostty_key_encoder_new: (allocator: number, out: number) => number;
  ghostty_key_encoder_free: (enc: number) => void;
  ghostty_key_encoder_setopt_from_terminal: (
    enc: number,
    term: number,
  ) => number;
  ghostty_key_encoder_encode: (
    enc: number,
    event: number,
    buf: number,
    bufLen: number,
    written: number,
  ) => number;
  ghostty_key_event_new: (allocator: number, out: number) => number;
  ghostty_key_event_free: (ev: number) => void;
  ghostty_key_event_set_action: (ev: number, action: number) => void;
  ghostty_key_event_set_key: (ev: number, key: number) => void;
  ghostty_key_event_set_mods: (ev: number, mods: number) => void;
  ghostty_key_event_set_utf8: (ev: number, ptr: number, len: number) => number;
  ghostty_mouse_encoder_new: (allocator: number, out: number) => number;
  ghostty_mouse_encoder_free: (enc: number) => void;
  ghostty_mouse_encoder_setopt_from_terminal: (
    enc: number,
    term: number,
  ) => number;
  ghostty_mouse_encoder_encode: (
    enc: number,
    event: number,
    buf: number,
    bufLen: number,
    written: number,
  ) => number;
  ghostty_mouse_event_new: (allocator: number, out: number) => number;
  ghostty_mouse_event_free: (ev: number) => void;
  ghostty_mouse_event_set_action: (ev: number, action: number) => void;
  ghostty_mouse_event_set_button: (ev: number, button: number) => void;
  ghostty_mouse_event_set_mods: (ev: number, mods: number) => void;
  ghostty_mouse_event_set_position: (ev: number, x: number, y: number) => void;
  [name: string]: unknown;
}

export interface TrampolineExports {
  f4: (a: number, b: number, c: number, d: number) => void;
  f2: (a: number, b: number) => void;
}

export interface LoadedWasm {
  exports: GhosttyExports;
  trampoline: TrampolineExports;
  /** Table index of the 4-arg JS trampoline (write_pty). */
  f4Index: number;
  /** Table index of the 2-arg JS trampoline (title/pwd). */
  f2Index: number;
}

export interface HostCallbacks {
  writePty: (
    term: number,
    userdata: number,
    dataPtr: number,
    len: number,
  ) => void;
  notify2: (term: number, userdata: number) => void;
}

const host: HostCallbacks = {
  writePty: () => {
    throw new Error("@kolu/ghostty-kit: writePty host not installed");
  },
  notify2: () => {
    throw new Error("@kolu/ghostty-kit: notify2 host not installed");
  },
};

export function installHostCallbacks(next: HostCallbacks): void {
  host.writePty = next.writePty;
  host.notify2 = next.notify2;
}

function vendorUrl(name: string): URL {
  return new URL(`../vendor/${name}`, import.meta.url);
}

function readVendor(name: string): Uint8Array {
  const url = vendorUrl(name);
  try {
    return new Uint8Array(readFileSync(fileURLToPath(url)));
  } catch (err) {
    throw new Error(
      `@kolu/ghostty-kit: official ${name} is missing at ${url.pathname} — ${err instanceof Error ? err.message : String(err)}`,
    );
  }
}

let loaded: LoadedWasm | undefined;

export function loadGhostty(): LoadedWasm {
  loaded ??= instantiate();
  return loaded;
}

function instantiate(): LoadedWasm {
  const wasmBytes = readVendor("ghostty-vt.wasm");
  const trampBytes = readVendor("trampoline.wasm");
  const instance = new WebAssembly.Instance(
    new WebAssembly.Module(wasmBytes.buffer as ArrayBuffer),
  );
  const exports = instance.exports as unknown as GhosttyExports;
  if (typeof exports.ghostty_terminal_vt_write !== "function") {
    throw new Error(
      "@kolu/ghostty-kit: ghostty-vt.wasm is not the official VT module (missing ghostty_terminal_vt_write)",
    );
  }
  const trampInst = new WebAssembly.Instance(
    new WebAssembly.Module(trampBytes.buffer as ArrayBuffer),
    {
      env: {
        f4: (a: number, b: number, c: number, d: number) =>
          host.writePty(a, b, c, d),
        f2: (a: number, b: number) => host.notify2(a, b),
      },
    },
  );
  const trampoline = trampInst.exports as unknown as TrampolineExports;
  const table = exports.__indirect_function_table;
  const f4Index = table.grow(1);
  table.set(f4Index, trampoline.f4);
  const f2Index = table.grow(1);
  table.set(f2Index, trampoline.f2);
  return { exports, trampoline, f4Index, f2Index };
}

/** Test-only: drop the cached instance so a subsequent load re-reads the file. */
export function resetLoadedForTests(): void {
  loaded = undefined;
}
