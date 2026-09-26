/**
 * Keyboard shortcut primitives — keybind types, matching, and platform-aware
 * formatting. The application-level action registry (label + handler + chord)
 * lives in `./actions.ts`.
 */

import { isMac as detectedIsMac } from "./platform";

/**
 * Which modifier a chord is held under — ONE value, because a chord has one
 * modifier role. (It was three independent booleans, `{mod, ctrl, meta}`, which
 * could spell combinations that mean nothing — `{mod: true, ctrl: true}` — and
 * left every consumer to re-derive the same precedence by hand.)
 *
 * Choosing between the first two is the one decision that matters in this file,
 * and it is not a matter of taste. **kolu holds its chords over a live PTY**, and
 * a chord kolu claims is `preventDefault`ed before xterm can forward the byte —
 * so a chord whose Ctrl form means something inside a terminal must not be
 * spelled `"cmdOrCtrl"`. `prohibitedKeybinds.ts` lists what is spoken for, and
 * `keyboard.test.ts` fails the build on a collision.
 */
export type ChordModifier =
  /** Cmd on macOS, **Super** (⊞ / Meta) elsewhere — the application's own
   *  modifier. A terminal program receives Ctrl as a byte and never sees this
   *  key at all, so this is the only role that is PTY-safe by construction, and
   *  the required choice whenever the Ctrl form of the chord belongs to a tool
   *  running inside kolu (readline's Ctrl+K / Ctrl+F / Ctrl+T, an agent's own
   *  bindings). */
  | "app"
  /** Cmd on macOS, **Ctrl** elsewhere — the platform's conventional shortcut
   *  modifier. Correct only where the Ctrl form is inert inside a terminal:
   *  digits, zoom, and every Ctrl+Shift+… chord. */
  | "cmdOrCtrl"
  /** The physical **Ctrl** key on every platform, macOS included. For chords
   *  macOS reserves Cmd for (e.g. Cmd+`). Subject to the same PTY rule as
   *  `"cmdOrCtrl"` — on BOTH platforms, since physical Ctrl is what a PTY reads. */
  | "ctrl";

/** A modifier role made physical: which `KeyboardEvent` flag carries it here,
 *  and how it prints. */
interface ResolvedModifier {
  /** The event flag this role reads on this platform. */
  flag: "ctrlKey" | "metaKey";
  /** Display prefix — a glyph on macOS, a word elsewhere. */
  label: string;
}

/**
 * The single place a modifier role becomes a physical key. Matching, event
 * synthesis, and display all read this and nothing else, so the mapping cannot
 * be re-derived — or drift — per call site.
 *
 * "Super" is the word X11, Wayland, and every Linux desktop use for the key;
 * Windows keycaps label it ⊞, and see the same word.
 */
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

/** Is the `"cmdOrCtrl"` modifier (Cmd on macOS, Ctrl elsewhere) held? For the
 *  two listeners that read a modifier without a whole chord — zoom, and the
 *  dock's modifier-held row hints. Resolved through `resolveModifier` so it
 *  cannot disagree with what `matchesKeybind` requires. `isMac` defaults to the
 *  detected host platform; pass it explicitly to keep the check a pure function
 *  of platform — for tests, or to reason about a chord for a non-host OS —
 *  instead of reaching for the module-level `userAgent` singleton. */
export function isPlatformModifier(
  e: KeyboardEvent,
  isMac = detectedIsMac,
): boolean {
  return e[resolveModifier("cmdOrCtrl", isMac).flag];
}

/** Zoom key deltas: maps key to font-size change direction. */
export const ZOOM_KEYS: Record<string, 1 | -1> = { "=": 1, "+": 1, "-": -1 };

/**
 * A keyboard shortcut definition: a key, the modifier role it is held under,
 * and the two modifiers that are genuinely additive (`alt`, `shift` — either can
 * ride along with any role).
 *
 * Use `code` (physical key via KeyboardEvent.code) when Shift changes the
 * reported `e.key` — e.g. Shift+[ reports key="{" but code="BracketLeft".
 */
export interface Keybind {
  /** Display key name (also used for matching when `code` is absent). */
  key: string;
  /** Physical key code (KeyboardEvent.code). Preferred over `key` for matching when set. */
  code?: string;
  /** Which modifier the chord is held under; absent means an unmodified key.
   *  See `ChordModifier` — picking between `"app"` and `"cmdOrCtrl"` is the
   *  PTY-safety decision, not a stylistic one. */
  modifier?: ChordModifier;
  /** Physical Alt/Option key. Used for chords macOS Chrome intercepts (e.g. Alt+Tab as an alternate to Ctrl+Tab). */
  alt?: boolean;
  shift?: boolean;
  /** Match whether shift is pressed or not. Used by stateful actions
   *  (e.g. MRU cycling) where shift modulates direction rather than
   *  participating in the chord identity. */
  shiftOptional?: boolean;
}

/** Check if a KeyboardEvent matches a keybind definition. `isMac` defaults to
 *  the detected host platform; injected by tests to exercise both. */
export function matchesKeybind(
  e: KeyboardEvent,
  kb: Keybind,
  isMac = detectedIsMac,
): boolean {
  // Prefer physical key code when specified (Shift changes e.key but not e.code)
  const keyMatch = kb.code ? e.code === kb.code : e.key === kb.key;
  if (!keyMatch) return false;
  // Modifier EXACTNESS, stated once for every role: the event must carry the
  // flag the chord names and NOT the other one. Ctrl+Super+K is a different
  // chord from Super+K, and claiming it would swallow the same Ctrl+K byte the
  // PTY is owed — the asymmetric per-role rejections this replaces let cases
  // like that through, each role loose in its own way.
  const wanted = kb.modifier ? resolveModifier(kb.modifier, isMac).flag : null;
  if (e.ctrlKey !== (wanted === "ctrlKey")) return false;
  if (e.metaKey !== (wanted === "metaKey")) return false;
  if (e.altKey !== (kb.alt === true)) return false;
  // Shift is the one declared exception to exactness: a `shiftOptional` chord
  // reads Shift as a direction, not as part of its identity.
  if (!kb.shiftOptional && e.shiftKey !== (kb.shift === true)) return false;
  return true;
}

/**
 * Synthesize a KeyboardEvent shape from a Keybind. Used by the
 * `PROHIBITED_KEYBINDS` collision test to ask "would the prohibited
 * chord match this registered action?" without constructing a real
 * event. Resolves the modifier through `resolveModifier` — the same path
 * `matchesKeybind` takes — so there is one source of modifier truth: an
 * `"app"` chord synthesizes `metaKey` and never `ctrlKey`, which is what makes
 * the collision test report it as PTY-safe. `isMac` defaults to the detected
 * host platform.
 */
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

/** Platform-aware display string for a keybind — "⌘1" on macOS, "Ctrl+1"
 *  elsewhere, and "Super+K" for an `"app"` chord off macOS. `isMac` defaults to
 *  the detected host platform. */
export function formatKeybind(kb: Keybind, isMac = detectedIsMac): string {
  const parts: string[] = [];
  if (kb.modifier) parts.push(resolveModifier(kb.modifier, isMac).label);
  if (kb.alt) parts.push(isMac ? "⌥" : "Alt");
  if (kb.shift) parts.push(isMac ? "⇧" : "Shift");
  const displayKey = kb.key.length === 1 ? kb.key.toUpperCase() : kb.key;
  parts.push(displayKey);
  return isMac ? parts.join("") : parts.join("+");
}
