/**
 * The printed-URL card's open state — a singleton target, evaluated only while
 * a card is open (never per-render, never frozen at click).
 *
 * Named `printedUrlCardState` (not `printedUrlCard`) so it never collides with
 * `PrintedUrlCard.tsx` on case-insensitive filesystems (macOS APFS / Nix store
 * volumes): TypeScript probes `PrintedUrlCard.ts` first and would bind this
 * module instead of the component, with no `PrintedUrlCard` export.
 *
 * The JOIN itself is a reactive derivation over the ports + forwards stores in
 * the card component; this module only holds *which* URL/terminal was clicked
 * and *where* to anchor the card.
 */

import type { TerminalId } from "kolu-common/surface";
import { createRoot, createSignal } from "solid-js";

export type PrintedUrlCardTarget = {
  terminalId: TerminalId;
  /** The raw URI as the link provider reported it. */
  uri: string;
  port: number;
  /** Scheme from the printout — doors carry TLS bytes when this is https:. */
  protocol: "http:" | "https:";
  pathname: string;
  search: string;
  hash: string;
  /** Viewport coordinates of the click — the card anchors here. */
  x: number;
  y: number;
};

const [target, setTarget] = createRoot(() =>
  createSignal<PrintedUrlCardTarget | null>(null),
);

export function openPrintedUrlCard(next: PrintedUrlCardTarget): void {
  setTarget(next);
}

export function closePrintedUrlCard(): void {
  setTarget(null);
}

export function printedUrlCardTarget(): PrintedUrlCardTarget | null {
  return target();
}
