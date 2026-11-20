import { Effect } from "effect";
import { controlByte, NAMED_KEY_BYTES } from "@kolu/terminal-protocol";
import { type Component, For, Show } from "solid-js";
import {
  applyStickyModifiers,
  stickyAlt,
  stickyCtrl,
  toggleStickyAlt,
  toggleStickyCtrl,
} from "./terminal/stickyModifiers";
import { personInput } from "./conductor/personInput";
import { runAction } from "./runAction";
import { useTerminalStore } from "./terminal/useTerminalStore";
import { isTouch } from "./useMobile";
import { activePadiRpc } from "./wire";

interface Key {
  label: string;
  data: string;
  testId: string;
}

const CTRL_C = controlByte("c");
if (CTRL_C === undefined) throw new Error("Ctrl+C must fold to a control byte");

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
    if (!personInput(id)) return;
    tick();
    runAction(
      "send key",
      activePadiRpc.lifecycle
        .sendInput({ id, data: applyStickyModifiers(data) })
        .pipe(Effect.ignore),
    );
  }

  return (
    <Show when={isTouch()}>
      <div
        // COLS (half the control count, rounded up) lays the controls out in
        // exactly two rows, so every key is reachable without the horizontal
        // scroll the old single overflow-x row forced. Inline grid-template
        // because the column count is data-derived — a dynamic Tailwind class
        // would be purged. Data-driven columns (same spirit as the dock).
        class="grid gap-1 px-2 py-1.5 bg-surface-1 border-t border-edge"
        style={{ "grid-template-columns": `repeat(${COLS}, minmax(0, 1fr))` }}
        data-testid="mobile-key-bar"
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
