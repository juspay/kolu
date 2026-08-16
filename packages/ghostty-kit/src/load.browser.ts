/** Browser wasm fetch. Imported only by the Solid tile — never by kaval. */

import { type LoadedWasm, loadGhostty, setVendorReader } from "./load.ts";

async function fetchVendor(name: string): Promise<Uint8Array> {
  const url = new URL(`../vendor/${name}`, import.meta.url);
  const res = await fetch(url);
  if (!res.ok) {
    throw new Error(
      `@kolu/ghostty-kit: official ${name} is missing at ${url.href} (${res.status})`,
    );
  }
  return new Uint8Array(await res.arrayBuffer());
}

/** Fetch the pinned wasm assets and install them for {@link loadGhostty}. */
export async function preloadGhostty(): Promise<LoadedWasm> {
  const [vt, trampoline] = await Promise.all([
    fetchVendor("ghostty-vt.wasm"),
    fetchVendor("trampoline.wasm"),
  ]);
  setVendorReader(() => ({ vt, trampoline }));
  return loadGhostty();
}
