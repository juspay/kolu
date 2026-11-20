import { isMac as detectedIsMac } from "./platform";

const MODAL_SCOPE_ATTR = "data-kolu-modal";

export const MODAL_SCOPE_SELECTOR = `[${MODAL_SCOPE_ATTR}="true"]`;

export function modalScopeAttrs() {
  return { [MODAL_SCOPE_ATTR]: "true" } as const;
}

export type ChordModifier = "app" | "cmdOrCtrl" | "ctrl";

interface ResolvedModifier {
  flag: "ctrlKey" | "metaKey";
  label: string;
}

function resolveModifier(
  modifier: ChordModifier,
  isMac: boolean,
): ResolvedModifier {
  switch (modifier) {
    case "app":
      return { flag: "metaKey", label: isMac ? "⌘" : "Super" };
    case "cmdOrCtrl":
      return isMac
        ? { flag: "metaKey", label: "⌘" }
        : { flag: "ctrlKey", label: "Ctrl" };
    case "ctrl":
      return { flag: "ctrlKey", label: isMac ? "⌃" : "Ctrl" };
  }
}

export function isPlatformModifier(
  e: KeyboardEvent,
  isMac = detectedIsMac,
): boolean {
  return e[resolveModifier("cmdOrCtrl", isMac).flag];
}

export const ZOOM_KEYS: Record<string, 1 | -1> = { "=": 1, "+": 1, "-": -1 };

export interface Keybind {
  key: string;
  /** Shift changes the reported `e.key` — Shift+[ reports key="{" but code="BracketLeft". */
  code?: string;
  modifier?: ChordModifier;
  alt?: boolean;
  shift?: boolean;
  shiftOptional?: boolean;
}

export function matchesKeybind(
  e: KeyboardEvent,
  kb: Keybind,
  isMac = detectedIsMac,
): boolean {
  const keyMatch = kb.code ? e.code === kb.code : e.key === kb.key;
  if (!keyMatch) return false;
  const wanted = kb.modifier ? resolveModifier(kb.modifier, isMac).flag : null;
  if (e.ctrlKey !== (wanted === "ctrlKey")) return false;
  if (e.metaKey !== (wanted === "metaKey")) return false;
  if (e.altKey !== (kb.alt === true)) return false;
  if (!kb.shiftOptional && e.shiftKey !== (kb.shift === true)) return false;
  return true;
}

export function keybindAsEvent(
  kb: Keybind,
  isMac = detectedIsMac,
): Partial<KeyboardEvent> {
  const wanted = kb.modifier ? resolveModifier(kb.modifier, isMac).flag : null;
  return {
    key: kb.key,
    code: kb.code,
    ctrlKey: wanted === "ctrlKey",
    metaKey: wanted === "metaKey",
    altKey: kb.alt === true,
    shiftKey: kb.shift === true,
  };
}

export function formatKeybind(kb: Keybind, isMac = detectedIsMac): string {
  const parts: string[] = [];
  if (kb.modifier) parts.push(resolveModifier(kb.modifier, isMac).label);
  if (kb.alt) parts.push(isMac ? "⌥" : "Alt");
  if (kb.shift) parts.push(isMac ? "⇧" : "Shift");
  const displayKey = kb.key.length === 1 ? kb.key.toUpperCase() : kb.key;
  parts.push(displayKey);
  return isMac ? parts.join("") : parts.join("+");
}
