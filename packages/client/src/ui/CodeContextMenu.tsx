/** Lightweight floating context menu used by the Code tab's diff/file
 *  viewers. Pierre's `@pierre/diffs` doesn't expose a built-in context-menu
 *  hook (only `@pierre/trees` does), so we build a minimal Solid menu over
 *  the host container's `contextmenu` event.
 *
 *  Items are computed from a `getItems` accessor that reads the current
 *  line selection — items can return null to omit themselves. */

import { type Component, createSignal, For, onCleanup, Show } from "solid-js";
import { Dynamic, Portal } from "solid-js/web";
import { toast } from "solid-sonner";
import { match } from "ts-pattern";
import { writeTextToClipboard } from "./clipboard";
import { surface } from "./Surface";

/** Two verbs over the same selection noun: copy a string to the clipboard,
 *  or invoke an action callback. The discriminator keeps the dispatch
 *  explicit so adding a third verb (e.g. "share") doesn't tempt the
 *  handler into reading every field on every item. Every item carries
 *  a leading icon — verbs like "Copy" and "Open" share the same label
 *  shape (`<verb> path:N`) and disambiguate poorly when only the first
 *  word differs; the glyph makes the verb readable at a glance. */
export type CodeContextMenuItem =
  | {
      kind: "copy";
      label: string;
      icon: Component<{ class?: string }>;
      /** Text written to the clipboard; success toast names the item. */
      textToCopy: string;
    }
  | {
      kind: "action";
      label: string;
      icon: Component<{ class?: string }>;
      /** Fired on click. The item is closed regardless of completion. */
      onActivate: () => void;
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
    match(item)
      .with({ kind: "copy" }, async ({ textToCopy }) => {
        try {
          await writeTextToClipboard(textToCopy);
          toast.success(`Copied: ${textToCopy}`);
        } catch (err) {
          console.error("Failed to copy:", err);
          toast.error(`Failed to copy: ${(err as Error).message}`);
        }
      })
      .with({ kind: "action" }, ({ onActivate }) => onActivate())
      .exhaustive();
    close();
  };

  const chrome = surface({ radius: "md", shadow: "bare", portalled: true });

  return (
    <Show when={open()}>
      <Portal>
        <div
          id="code-context-menu"
          role="menu"
          class={`fixed z-50 min-w-40 ${chrome.class} p-1 text-[11px] text-fg`}
          style={{ left: `${pos().x}px`, top: `${pos().y}px`, ...chrome.style }}
        >
          <For each={items()}>
            {(item) => (
              <button
                type="button"
                role="menuitem"
                class="flex w-full cursor-pointer items-center gap-2 rounded px-2 py-1 text-left hover:bg-surface-2"
                onClick={() => handleItem(item)}
              >
                <Dynamic
                  component={item.icon}
                  class="w-3.5 h-3.5 shrink-0 opacity-70"
                />
                <span>{item.label}</span>
              </button>
            )}
          </For>
        </div>
      </Portal>
    </Show>
  );
};

export default CodeContextMenu;
