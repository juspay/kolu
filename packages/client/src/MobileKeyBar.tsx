/** Mobile key bar — sends the keys a soft keyboard can't: Esc, Tab,
 *  Shift+Tab, arrows, Ctrl+C, `/`, and a dedicated Enter that bypasses
 *  the IME (some Android keyboards swallow Enter as a literal newline
 *  in xterm's hidden textarea instead of dispatching a keydown).
 *
 *  Two leading toggles arm sticky Ctrl / Alt: tap to arm, then the next
 *  character — typed on the soft keyboard or sent from this bar — folds
 *  into the chord (Ctrl+R, Alt+f, …) and the modifier disarms. See
 *  `terminal/stickyModifiers.ts`; the fold itself is applied both here and
 *  in the terminal's `onData`, so soft-keyboard letters compose too.
 *
 *  Shown only on coarse-pointer devices. Stateless beyond the shared
 *  sticky-modifier signal — writes escape sequences straight to the PTY via
 *  client.terminal.sendInput, with a 10ms haptic tick on devices that
 *  support navigator.vibrate. Targets the store's `focusedId` — the active
 *  split when one has focus, not the tile root — so the keys reach whichever
 *  terminal the user is typing into (soft-keyboard letters already do, via
 *  xterm's own onData). */

import type { TerminalId } from "kolu-common/surface";
import { type Component, For, Show } from "solid-js";
import {
  applyStickyModifiers,
  stickyAlt,
  stickyCtrl,
  toggleStickyAlt,
  toggleStickyCtrl,
} from "./terminal/stickyModifiers";
import { isTouch } from "./useMobile";
import { client } from "./wire";

interface Key {
  label: string;
  data: string;
  testId: string;
}

const KEYS: readonly Key[] = [
  { label: "Esc", data: "\x1b", testId: "esc" },
  { label: "Tab", data: "\t", testId: "tab" },
  { label: "⇧Tab", data: "\x1b[Z", testId: "shift-tab" },
  { label: "↑", data: "\x1b[A", testId: "up" },
  { label: "↓", data: "\x1b[B", testId: "down" },
  { label: "←", data: "\x1b[D", testId: "left" },
  { label: "→", data: "\x1b[C", testId: "right" },
  { label: "^C", data: "\x03", testId: "ctrl-c" },
  { label: "/", data: "/", testId: "slash" },
  { label: "⏎", data: "\r", testId: "enter" },
];

interface Mod {
  label: string;
  testId: string;
  armed: () => boolean;
  toggle: () => void;
}

const MODS: readonly Mod[] = [
  {
    label: "Ctrl",
    testId: "ctrl",
    armed: stickyCtrl,
    toggle: toggleStickyCtrl,
  },
  { label: "Alt", testId: "alt", armed: stickyAlt, toggle: toggleStickyAlt },
];

// Column count derived from the control lists so the "two rows" invariant is
// mechanical, not a hardcoded literal that silently goes ragged when a key is
// added. ceil(total / 2) is the minimal column count that yields exactly two
// rows for any control count — including an odd total, where a plain /2 would
// produce a fractional `repeat()` and break the grid.
const COLS = Math.ceil((KEYS.length + MODS.length) / 2);

const KEY_CLASS =
  "px-2 py-1.5 text-xs text-center rounded-md transition-colors cursor-pointer font-mono";
const KEY_UNARMED_CLASS =
  "bg-surface-2 text-fg-2 hover:bg-surface-3 active:bg-surface-3";

const MobileKeyBar: Component<{
  /** The terminal currently receiving input — the active split when one has
   *  focus, else the tile root. See `useTerminalStore.focusedId`. */
  focusedId: () => TerminalId | null;
}> = (props) => {
  // 10ms haptic tick — Android only; iOS Safari doesn't implement
  // navigator.vibrate, so the guard makes it a silent no-op there.
  function tick() {
    if ("vibrate" in navigator) navigator.vibrate(10);
  }

  function send(data: string) {
    const id = props.focusedId();
    if (!id) return;
    tick();
    void client.terminal.sendInput({ id, data: applyStickyModifiers(data) });
  }

  return (
    <Show when={isTouch()}>
      <div
        // COLS (half the control count, rounded up) lays the controls out in
        // exactly two rows, so every key is reachable without the horizontal
        // scroll the old single overflow-x row forced. Inline grid-template
        // because the column count is data-derived — a dynamic Tailwind class
        // would be purged. Mirrors WorkspaceGrid.tsx's data-driven columns.
        class="grid gap-1 px-2 py-1.5 bg-surface-1 border-t border-edge"
        style={{ "grid-template-columns": `repeat(${COLS}, minmax(0, 1fr))` }}
        data-testid="mobile-key-bar"
        // The key bar lives inside MobileTileView's swipe wrapper, whose
        // touchstart/touchend cycle terminals on a horizontal swipe. A
        // finger drag across these keys would otherwise bubble up and switch
        // the active terminal mid-type.
        // stopPropagation on touchstart keeps the wrapper from ever recording
        // a swipe origin here — same guard the pull/dock handles use.
        onTouchStart={(e: TouchEvent) => e.stopPropagation()}
      >
        <For each={MODS}>
          {(mod) => (
            <button
              type="button"
              aria-pressed={mod.armed()}
              // preventDefault on pointerdown keeps xterm's hidden textarea
              // focused — otherwise iOS dismisses the soft keyboard on every tap.
              onPointerDown={(e) => {
                e.preventDefault();
                tick();
                mod.toggle();
              }}
              class={KEY_CLASS}
              classList={{
                "bg-accent/20 text-fg ring-1 ring-accent": mod.armed(),
                [KEY_UNARMED_CLASS]: !mod.armed(),
              }}
              data-testid={`mobile-key-${mod.testId}`}
            >
              {mod.label}
            </button>
          )}
        </For>
        <For each={KEYS}>
          {(key) => (
            <button
              type="button"
              onPointerDown={(e) => {
                e.preventDefault();
                send(key.data);
              }}
              class={`${KEY_CLASS} ${KEY_UNARMED_CLASS}`}
              data-testid={`mobile-key-${key.testId}`}
            >
              {key.label}
            </button>
          )}
        </For>
      </div>
    </Show>
  );
};

export default MobileKeyBar;
