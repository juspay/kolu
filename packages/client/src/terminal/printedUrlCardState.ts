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
