import { GHOSTTY_SUCCESS } from "./constants.ts";
import type { GhosttyExports, LoadedWasm } from "./load.ts";

export class GhosttyError extends Error {
  readonly result: number;
  constructor(op: string, result: number) {
    super(`@kolu/ghostty-kit: ${op} failed (GhosttyResult ${result})`);
    this.name = "GhosttyError";
    this.result = result;
  }
}

export function check(op: string, result: number): void {
  if (result !== GHOSTTY_SUCCESS) throw new GhosttyError(op, result);
}

export class Ffi {
  readonly wasm: LoadedWasm;
  constructor(wasm: LoadedWasm) {
    this.wasm = wasm;
  }

  get e(): GhosttyExports {
    return this.wasm.exports;
  }

  memory(): ArrayBuffer {
    return this.e.memory.buffer;
  }

  view(): DataView {
    return new DataView(this.memory());
  }

  u32(ptr: number): number {
    return this.view().getUint32(ptr, true);
  }

  setU32(ptr: number, value: number): void {
    this.view().setUint32(ptr, value, true);
  }

  setU8(ptr: number, value: number): void {
    this.view().setUint8(ptr, value);
  }

  allocBytes(len: number): number {
    const ptr = this.e.ghostty_wasm_alloc(len);
    if (ptr === 0) throw new Error("@kolu/ghostty-kit: out of wasm memory");
    return ptr;
  }

  freeBytes(ptr: number, len: number): void {
    this.e.ghostty_wasm_free(ptr, len);
  }

  allocOpaque(): number {
    const ptr = this.e.ghostty_wasm_alloc_opaque();
    if (ptr === 0) throw new Error("@kolu/ghostty-kit: out of wasm memory");
    return ptr;
  }

  takeOpaque(slot: number): number {
    return this.e.ghostty_wasm_take_opaque(slot);
  }

  /** wasm32 usize / pointer-width out slot. */
  allocUsize(): number {
    return this.allocBytes(4);
  }

  writeBytes(bytes: Uint8Array): number {
    const ptr = this.allocBytes(bytes.length);
    new Uint8Array(this.memory(), ptr, bytes.length).set(bytes);
    return ptr;
  }

  readBytes(ptr: number, len: number): Uint8Array {
    return new Uint8Array(this.memory(), ptr, len).slice();
  }

  readUtf8(ptr: number, len: number): string {
    return new TextDecoder().decode(new Uint8Array(this.memory(), ptr, len));
  }

  readCString(ptr: number): string {
    const u8 = new Uint8Array(this.memory());
    let end = ptr;
    while (u8[end] !== 0) end++;
    return this.readUtf8(ptr, end - ptr);
  }

  /** GhosttyString at `ptr`: { ptr: u32, len: u32 }. */
  readString(ptr: number): string {
    const p = this.u32(ptr);
    const len = this.u32(ptr + 4);
    if (p === 0 || len === 0) return "";
    return this.readUtf8(p, len);
  }

  getU32(term: number, data: number): number {
    const out = this.allocUsize();
    try {
      check(
        `terminal_get(${data})`,
        this.e.ghostty_terminal_get(term, data, out),
      );
      return this.u32(out);
    } finally {
      this.freeBytes(out, 4);
    }
  }

  getString(term: number, data: number): string {
    const out = this.allocBytes(8);
    try {
      new Uint8Array(this.memory(), out, 8).fill(0);
      const result = this.e.ghostty_terminal_get(term, data, out);
      if (result !== GHOSTTY_SUCCESS) return "";
      return this.readString(out);
    } finally {
      this.freeBytes(out, 8);
    }
  }
}
