import { Option } from "effect";
import type { TerminalId } from "kolu-common/surface";
import { fleetTerminalRef } from "kolu-mcp/fleetRef";
import { createSignal } from "solid-js";
import { encActiveHost } from "../wire";
import { useMembership } from "./useWorks";
import { inputAllowed } from "./workReadings";

export function activeTerminalRef(id: TerminalId): string {
  return fleetTerminalRef(encActiveHost(), id);
}

const [carded, setCarded] = createSignal<string | null>(null);

const CARD_MS = 4000;

let cardTimer: ReturnType<typeof setTimeout> | null = null;

function raiseLockCard(terminal: string): void {
  setCarded(terminal);
  clearTimeout(cardTimer ?? undefined);
  cardTimer = setTimeout(() => {
    cardTimer = null;
    setCarded(null);
  }, CARD_MS);
}

export function personInput(id: TerminalId): boolean {
  const terminal = activeTerminalRef(id);
  if (inputAllowed(Option.fromUndefinedOr(useMembership()().get(terminal))))
    return true;
  raiseLockCard(terminal);
  return false;
}

export function lockCardShown(terminal: string): boolean {
  return carded() === terminal;
}

export function dismissLockCard(): void {
  clearTimeout(cardTimer ?? undefined);
  cardTimer = null;
  setCarded(null);
}
