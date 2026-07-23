/** One open diagnostics host for the strip — a module-level key so hovering
 *  chip A never leaves chip B's panel also mounted. Chips open/close through
 *  these accessors; the popover itself stays presentational. */

import { createSignal } from "solid-js";

const [openKey, setOpenKey] = createSignal<string | null>(null);

/** Canonical encoded host key of the open diagnostics panel, or null. */
export function diagnosticsOpenKey(): string | null {
  return openKey();
}

export function isDiagnosticsOpen(encKey: string): boolean {
  return openKey() === encKey;
}

export function openDiagnostics(encKey: string): void {
  setOpenKey(encKey);
}

export function closeDiagnostics(): void {
  setOpenKey(null);
}

/** Toggle: open this host's panel, or close it if already this host. */
export function toggleDiagnostics(encKey: string): void {
  setOpenKey((cur) => (cur === encKey ? null : encKey));
}
