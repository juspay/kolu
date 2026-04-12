/** Mobile key bar — sends the keys a soft keyboard can't: Esc, Tab,
 *  Shift+Tab, arrows, Ctrl+C, `/`, and a dedicated Enter that bypasses
 *  the IME (some Android keyboards swallow Enter as a literal newline
 *  in xterm's hidden textarea instead of dispatching a keydown).
 *
 *  Shown only on coarse-pointer devices. Stateless — writes escape
 *  sequences straight to the PTY via client.terminal.sendInput, with
 *  a 10ms haptic tick on devices that support navigator.vibrate. */

import { type Component, For, Show, createSignal, onCleanup } from "solid-js";
import { createMediaQuery } from "@solid-primitives/media";
import { client } from "./rpc";
import type { TerminalId } from "kolu-common";

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

/** Whether the browser supports the VirtualKeyboard API (Chrome 94+). */
const hasVirtualKeyboard = "virtualKeyboard" in navigator;

const MobileKeyBar: Component<{
  activeId: () => TerminalId | null;
}> = (props) => {
  const isCoarse = createMediaQuery("(pointer: coarse)");

  // Derive soft-keyboard visibility from the browser's ground truth
  // so the toggle stays in sync even when dismissed via Android's
  // back gesture or system navigation.
  const [kbVisible, setKbVisible] = createSignal(false);
  if (hasVirtualKeyboard) {
    const vk = navigator.virtualKeyboard!;
    const onGeometry = () => setKbVisible(vk.boundingRect.height > 0);
    vk.addEventListener("geometrychange", onGeometry);
    onCleanup(() => vk.removeEventListener("geometrychange", onGeometry));
  }

  function send(data: string) {
    const id = props.activeId();
    if (!id) return;
    // 10ms haptic tick — Android only; iOS Safari doesn't implement
    // navigator.vibrate, so the guard makes it a silent no-op there.
    if ("vibrate" in navigator) navigator.vibrate(10);
    void client.terminal.sendInput({ id, data });
  }

  function toggleKeyboard() {
    if (!hasVirtualKeyboard) return;
    const vk = navigator.virtualKeyboard!;
    if (kbVisible()) vk.hide();
    else vk.show();
  }

  return (
    <Show when={isCoarse()}>
      <div
        class="flex gap-1 px-2 py-1.5 bg-surface-1 border-t border-edge overflow-x-auto"
        data-testid="mobile-key-bar"
      >
        <Show when={hasVirtualKeyboard}>
          <button
            type="button"
            onPointerDown={(e) => {
              e.preventDefault();
              toggleKeyboard();
            }}
            class="shrink-0 min-w-[2.5rem] px-2 py-1.5 text-xs rounded-md bg-surface-2 text-fg-2 hover:bg-surface-3 active:bg-surface-3 transition-colors cursor-pointer font-mono"
            classList={{ "!bg-accent-2/20 !text-accent-2": kbVisible() }}
            data-testid="mobile-key-keyboard-toggle"
            title={kbVisible() ? "Hide keyboard" : "Show keyboard"}
          >
            ⌨
          </button>
        </Show>
        <For each={KEYS}>
          {(key) => (
            <button
              type="button"
              // preventDefault on pointerdown keeps xterm's hidden textarea
              // focused — otherwise iOS dismisses the soft keyboard on every tap.
              onPointerDown={(e) => {
                e.preventDefault();
                send(key.data);
              }}
              class="shrink-0 min-w-[2.5rem] px-2 py-1.5 text-xs rounded-md bg-surface-2 text-fg-2 hover:bg-surface-3 active:bg-surface-3 transition-colors cursor-pointer font-mono"
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
