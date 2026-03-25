/** Minimal positioned context menu — renders at (x, y) with action items. */

import { type Component, For, onMount, onCleanup } from "solid-js";

export interface ContextMenuItem {
  label: string;
  onSelect: () => void;
  danger?: boolean;
}

const ContextMenu: Component<{
  x: number;
  y: number;
  items: ContextMenuItem[];
  onClose: () => void;
}> = (props) => {
  let ref!: HTMLDivElement;

  onMount(() => {
    // Close on click outside or escape
    function handleClick(e: MouseEvent) {
      if (!ref.contains(e.target as Node)) props.onClose();
    }
    function handleKey(e: KeyboardEvent) {
      if (e.key === "Escape") props.onClose();
    }
    document.addEventListener("mousedown", handleClick);
    document.addEventListener("keydown", handleKey, { capture: true });
    onCleanup(() => {
      document.removeEventListener("mousedown", handleClick);
      document.removeEventListener("keydown", handleKey, { capture: true });
    });

    // Clamp to viewport so the menu doesn't overflow offscreen
    const rect = ref.getBoundingClientRect();
    if (rect.right > window.innerWidth)
      ref.style.left = `${window.innerWidth - rect.width - 4}px`;
    if (rect.bottom > window.innerHeight)
      ref.style.top = `${window.innerHeight - rect.height - 4}px`;
  });

  return (
    <div
      ref={ref}
      class="fixed z-50 min-w-36 py-1 bg-surface-2 border border-edge-bright rounded-lg shadow-xl"
      style={{ left: `${props.x}px`, top: `${props.y}px` }}
    >
      <For each={props.items}>
        {(item) => (
          <button
            class="w-full px-3 py-1.5 text-sm text-left transition-colors"
            classList={{
              "text-fg-2 hover:text-fg hover:bg-surface-3": !item.danger,
              "text-danger hover:bg-danger/10": item.danger ?? false,
            }}
            onClick={() => {
              item.onSelect();
              props.onClose();
            }}
          >
            {item.label}
          </button>
        )}
      </For>
    </div>
  );
};

export default ContextMenu;
