/** Load the official `ghostty-vt.wasm` once. Throws if the asset is missing.
 *
 *  This file is reachable from the browser tile. It must not import `node:fs`
 *  (Vite externalizes it and the page never mounts — see `just test-dev`).
 *  Node installs a file-backed vendor reader from `index.ts`; the browser
 *  preloads via `load.browser.ts`. */

export type VendorBytes = { vt: Uint8Array; trampoline: Uint8Array };

let vendorReader: (() => VendorBytes) | undefined;

/** Install how wasm bytes are obtained. Node barrel and browser preload call this. */
export function setVendorReader(read: () => VendorBytes): void {
  vendorReader = read;
}

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
  ghostty_unicode_codepoint_width: (cp: number) => number;
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

let loaded: LoadedWasm | undefined;

export function loadGhostty(): LoadedWasm {
  loaded ??= instantiate();
  return loaded;
}

function readVendorBytes(): VendorBytes {
  if (!vendorReader) {
    throw new Error(
      "@kolu/ghostty-kit: wasm reader is not installed — Node must import the package barrel; the browser must preloadGhostty()",
    );
  }
  return vendorReader();
}

function instantiate(): LoadedWasm {
  const { vt: wasmBytes, trampoline: trampBytes } = readVendorBytes();
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
