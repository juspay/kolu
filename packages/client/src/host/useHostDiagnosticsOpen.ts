import { createSelector, createSignal } from "solid-js";
import { createSharedRoot } from "../createSharedRoot";

const [openKey, setOpenKey] = createSignal<string | null>(null);
const [anchor, setAnchor] = createSignal<HTMLElement | undefined>();

export { openKey as openHostDiagnosticsKey, anchor as hostDiagnosticsAnchor };

export const useHostDiagnosticsSelector = createSharedRoot(() =>
  createSelector(openKey),
);

export function openHostDiagnostics(encKey: string, el: HTMLElement): void {
  setOpenKey(encKey);
  setAnchor(el);
}

export function closeHostDiagnostics(): void {
  setOpenKey(null);
  setAnchor(undefined);
}

export function toggleHostDiagnostics(encKey: string, el: HTMLElement): void {
  if (openKey() === encKey) closeHostDiagnostics();
  else openHostDiagnostics(encKey, el);
}

export function releaseHostDiagnosticsAnchor(el: HTMLElement): void {
  if (anchor() === el) closeHostDiagnostics();
}
