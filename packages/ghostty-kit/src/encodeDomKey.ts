/** KeyboardEvent → PTY bytes. The textarea onKeyDown path and its tests
 *  share this so a missing Delete/Home/Fn/Alt/DECCKM cannot hide. */

export interface DomKey {
  key: string;
  ctrlKey?: boolean;
  altKey?: boolean;
  metaKey?: boolean;
  shiftKey?: boolean;
}

const ARROWS: Record<string, string> = {
  ArrowUp: "A",
  ArrowDown: "B",
  ArrowRight: "C",
  ArrowLeft: "D",
};

const APP_HOME_END: Record<string, string> = {
  Home: "H",
  End: "F",
};

const FUNCTION_KEYS: Record<string, string> = {
  F1: "\x1bOP",
  F2: "\x1bOQ",
  F3: "\x1bOR",
  F4: "\x1bOS",
  F5: "\x1b[15~",
  F6: "\x1b[17~",
  F7: "\x1b[18~",
  F8: "\x1b[19~",
  F9: "\x1b[20~",
  F10: "\x1b[21~",
  F11: "\x1b[23~",
  F12: "\x1b[24~",
};

function controlByte(char: string): string | null {
  if (char === " ") return "\x00";
  const code = char.toUpperCase().charCodeAt(0);
  if (code >= 0x40 && code <= 0x5f) return String.fromCharCode(code & 0x1f);
  return null;
}

function encodeBare(ev: DomKey, applicationCursor: boolean): string | null {
  if (ev.key === "Enter") return "\r";
  if (ev.key === "Backspace") return "\x7f";
  if (ev.key === "Tab") return ev.shiftKey ? "\x1b[Z" : "\t";
  if (ev.key === "Escape") return "\x1b";
  if (ev.key === "Delete") return "\x1b[3~";
  if (ev.key === "Insert") return "\x1b[2~";
  if (ev.key === "PageUp") return "\x1b[5~";
  if (ev.key === "PageDown") return "\x1b[6~";
  const fn = FUNCTION_KEYS[ev.key];
  if (fn !== undefined) return fn;
  const arrow = ARROWS[ev.key];
  if (arrow !== undefined) {
    return applicationCursor ? `\x1bO${arrow}` : `\x1b[${arrow}`;
  }
  const homeEnd = APP_HOME_END[ev.key];
  if (homeEnd !== undefined) {
    return applicationCursor ? `\x1bO${homeEnd}` : `\x1b[${homeEnd}`;
  }
  if (ev.ctrlKey && ev.key.length === 1) return controlByte(ev.key);
  if (ev.key.length === 1) return ev.key;
  return null;
}

/** Bytes to write to the PTY for this key, or null if the browser should keep it
 *  (Meta chords, modifier-only). Alt prefixes ESC. DECCKM arrows use SS3. */
export function encodeDomKey(
  ev: DomKey,
  opts?: { applicationCursor?: boolean },
): string | null {
  if (ev.metaKey) return null;
  if (
    ev.key === "Control" ||
    ev.key === "Alt" ||
    ev.key === "Shift" ||
    ev.key === "Meta"
  ) {
    return null;
  }
  const bare = encodeBare(ev, opts?.applicationCursor === true);
  if (bare === null) return null;
  if (ev.altKey) return `\x1b${bare}`;
  return bare;
}
