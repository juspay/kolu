import { makeEventListener } from "@solid-primitives/event-listener";
import type { TerminalId } from "kolu-common/surface";
import { DEFAULT_FONT_SIZE } from "terminal-themes";
import { persistedPref } from "../persistedPref";
import { isPlatformModifier, ZOOM_KEYS } from "./keyboard";

export function createZoom(terminalId: TerminalId, isFocused: () => boolean) {
  const [fontSize, setFontSize] = persistedPref<number>({
    name: `kolu-font-size-${terminalId}`,
    fallback: DEFAULT_FONT_SIZE,
    serialize: String,
    parse: (raw) => {
      const n = Number(raw);
      if (!Number.isFinite(n) || n <= 0) {
        throw new Error(`invalid persisted font size: ${raw}`);
      }
      return n;
    },
  });

  makeEventListener(
    window,
    "keydown",
    (e: KeyboardEvent) => {
      if (!isFocused()) return;
      if (!isPlatformModifier(e)) return;

      if (e.key === "0") {
        e.preventDefault();
        e.stopPropagation();
        setFontSize(DEFAULT_FONT_SIZE);
        return;
      }

      const delta = ZOOM_KEYS[e.key];
      if (!delta) return;
      e.preventDefault();
      e.stopPropagation();
      setFontSize((prev) => prev + delta);
    },
    { capture: true },
  );

  return fontSize;
}
