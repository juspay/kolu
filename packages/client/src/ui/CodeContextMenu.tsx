/** Lightweight floating context menu used by the Code tab's diff/file
 *  viewers. Pierre's `@pierre/diffs` doesn't expose a built-in context-menu
 *  hook (only `@pierre/trees` does), so we build a minimal Solid menu over
 *  the host container's `contextmenu` event.
 *
 *  Items are computed from a `getItems` accessor that reads the current
 *  line selection — items can return null to omit themselves. */

import { type Component, createSignal, For, onCleanup, Show } from "solid-js";
import { Portal } from "solid-js/web";
import { toast } from "solid-sonner";

export type CodeContextMenuItem = {
  label: string;
  /** Returned text gets copied; success toast names the item. */
  textToCopy: string;
};

export type CodeContextMenuController = {
  /** Bind to a host element's `oncontextmenu`. */
  open: (event: MouseEvent) => void;
};

/** Render `<CodeContextMenu items={...} ref={ctrl => ...} />` next to your
 *  host element, then call `ctrl.open(event)` from the host's
 *  `oncontextmenu`. The menu auto-closes on outside-click or Escape. */
export const CodeContextMenu: Component<{
  /** Items shown when the menu opens. Recomputed per open so they can
   *  reflect the current line selection. */
  getItems: () => CodeContextMenuItem[];
  /** Called once with the controller object after mount. */
  ref: (ctrl: CodeContextMenuController) => void;
}> = (props) => {
  const [open, setOpen] = createSignal(false);
  const [pos, setPos] = createSignal<{ x: number; y: number }>({ x: 0, y: 0 });
  const [items, setItems] = createSignal<CodeContextMenuItem[]>([]);

  props.ref({
    open: (event: MouseEvent) => {
      const next = props.getItems();
      if (next.length === 0) return; // nothing to offer; let browser default through
      event.preventDefault();
      setItems(next);
      setPos({ x: event.clientX, y: event.clientY });
      setOpen(true);
    },
  });

  const close = () => setOpen(false);

  const onDocClick = (e: MouseEvent) => {
    if (!open()) return;
    const target = e.target as Node | null;
    const menu = document.getElementById("code-context-menu");
    if (target && menu?.contains(target)) return;
    close();
  };
  const onKeydown = (e: KeyboardEvent) => {
    if (e.key === "Escape") close();
  };

  document.addEventListener("mousedown", onDocClick);
  document.addEventListener("keydown", onKeydown);
  onCleanup(() => {
    document.removeEventListener("mousedown", onDocClick);
    document.removeEventListener("keydown", onKeydown);
  });

  const handleItem = (item: CodeContextMenuItem) => {
    navigator.clipboard
      .writeText(item.textToCopy)
      .then(() => toast.success(`Copied: ${item.textToCopy}`))
      .catch((err: Error) => toast.error(`Failed to copy: ${err.message}`));
    close();
  };

  return (
    <Show when={open()}>
      <Portal>
        <div
          id="code-context-menu"
          role="menu"
          class="fixed z-50 min-w-40 rounded-md border border-edge bg-surface-1 p-1 text-[11px] text-fg shadow-lg"
          style={{ left: `${pos().x}px`, top: `${pos().y}px` }}
        >
          <For each={items()}>
            {(item) => (
              <button
                type="button"
                role="menuitem"
                class="block w-full cursor-pointer rounded px-2 py-1 text-left hover:bg-surface-2"
                onClick={() => handleItem(item)}
              >
                {item.label}
              </button>
            )}
          </For>
        </div>
      </Portal>
    </Show>
  );
};

export default CodeContextMenu;
