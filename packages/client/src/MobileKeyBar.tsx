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

import { controlByte, NAMED_KEY_BYTES } from "@kolu/terminal-protocol";
import { type Component, For, Show } from "solid-js";
import {
  applyStickyModifiers,
  stickyAlt,
  stickyCtrl,
  toggleStickyAlt,
  toggleStickyCtrl,
} from "./terminal/stickyModifiers";
import { useTerminalStore } from "./terminal/useTerminalStore";
import { isTouch } from "./useMobile";
import { client } from "./wire";

interface Key {
  label: string;
  data: string;
  testId: string;
}

// ^C is the Ctrl-fold of `c` (0x03) drawn from the shared fold, not a re-typed
// literal. `c` sits in the foldable 0x40–0x5f range so the fold always yields a
// byte; guard it so a future fold change that broke it crashes loudly here
// rather than sending `undefined` to a PTY.
const CTRL_C = controlByte("c");
if (CTRL_C === undefined) throw new Error("Ctrl+C must fold to a control byte");

// Byte values come from @kolu/terminal-protocol's shared key table / Ctrl fold,
// so the bar speaks the one vocabulary the rich client and the `send` CLI do;
// only the labels, testIds, and the literal `/` are bar-local.
const KEYS: readonly Key[] = [
  { label: "Esc", data: NAMED_KEY_BYTES.esc, testId: "esc" },
  { label: "Tab", data: NAMED_KEY_BYTES.tab, testId: "tab" },
  { label: "⇧Tab", data: NAMED_KEY_BYTES["shift-tab"], testId: "shift-tab" },
  { label: "↑", data: NAMED_KEY_BYTES.up, testId: "up" },
  { label: "↓", data: NAMED_KEY_BYTES.down, testId: "down" },
  { label: "←", data: NAMED_KEY_BYTES.left, testId: "left" },
  { label: "→", data: NAMED_KEY_BYTES.right, testId: "right" },
  { label: "^C", data: CTRL_C, testId: "ctrl-c" },
  { label: "/", data: "/", testId: "slash" },
  { label: "⏎", data: NAMED_KEY_BYTES.enter, testId: "enter" },
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

const MobileKeyBar: Component = () => {
  const store = useTerminalStore();
  // 10ms haptic tick — Android only; iOS Safari doesn't implement
  // navigator.vibrate, so the guard makes it a silent no-op there.
  function tick() {
    if ("vibrate" in navigator) navigator.vibrate(10);
  }

  function send(data: string) {
    const id = store.focusedId();
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
