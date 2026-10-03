/** Owned terminal bodies supply focus targets in every workspace layout. */
import { terminalElements } from "../terminal/terminalElements";

export function getActiveTerminalNode(): HTMLElement | null {
  for (const terminal of terminalElements()) {
    if (
      terminal.hasAttribute("data-visible") &&
      terminal.hasAttribute("data-focused")
    )
      return terminal;
  }
  return getFirstTerminalNode();
}

export function getFirstTerminalNode(): HTMLElement | null {
  for (const terminal of terminalElements()) {
    if (terminal.hasAttribute("data-visible")) return terminal;
  }
  return null;
}
