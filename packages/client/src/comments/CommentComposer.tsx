/** Shared composer popover. Reads `composerState` (singleton), renders
 *  when a target is set, writes the comment to `useComments` on Save.
 *  Mounted ONCE per CodeTab — any capture surface (text browse, branch
 *  diff, HTML iframe) routes through the same composer. */

import type { SelectionRect } from "@kolu/artifact-sdk/client";
import { type Component, createSignal, Show } from "solid-js";
import { Portal } from "solid-js/web";
import { useComposer } from "./composerState";
import { useComments } from "./useComments";

const COMPOSER_WIDTH = 320;
const COMPOSER_GAP = 8;

/** Clamp the popover so it stays inside the viewport. The selection rect
 *  might be near the right or bottom edge — we place the popover just
 *  below and right of the rect, then pull it back if needed. */
function clampPosition(
  rect: SelectionRect,
  popW: number,
  popH: number,
): { top: number; left: number } {
  const vw = window.innerWidth;
  const vh = window.innerHeight;
  let left = rect.x;
  let top = rect.y + rect.height + COMPOSER_GAP;
  if (left + popW + 8 > vw) left = Math.max(8, vw - popW - 8);
  if (top + popH + 8 > vh) top = Math.max(8, rect.y - popH - COMPOSER_GAP);
  return { top, left };
}

export const CommentComposer: Component<{
  terminalId: string;
}> = (props) => {
  const composer = useComposer();
  const [body, setBody] = createSignal("");

  const submit = (): void => {
    const target = composer.target();
    if (!target) return;
    const trimmed = body().trim();
    if (trimmed.length === 0) {
      composer.close();
      setBody("");
      return;
    }
    useComments(props.terminalId).add({
      path: target.path,
      locator: target.locator,
      lineRange: target.lineRange,
      surface: target.surface,
      body: trimmed,
    });
    composer.close();
    setBody("");
  };

  const cancel = (): void => {
    composer.close();
    setBody("");
  };

  return (
    <Show when={composer.target()}>
      {(target) => {
        // Estimated popover height (auto-sized; this is a reasonable
        // starting estimate for clamp math — the popover may render
        // slightly taller, but clamp keeps it on screen).
        const pos = clampPosition(target().rect, COMPOSER_WIDTH, 180);
        return (
          <Portal>
            <div
              role="dialog"
              aria-label="Add comment"
              data-testid="kolu-comment-composer"
              data-kolu-modal="true"
              style={{
                position: "fixed",
                top: `${pos.top}px`,
                left: `${pos.left}px`,
                width: `${COMPOSER_WIDTH}px`,
              }}
              class="z-50 rounded-md border border-edge bg-surface-1 shadow-xl p-3 font-sans text-[12px]"
              onKeyDown={(e) => {
                // stopPropagation: kolu has document-level shortcuts
                // (terminal hotkeys, command palette) that would otherwise
                // swallow ⌘↵ / Escape before the composer ever sees them.
                if (e.key === "Escape") {
                  e.preventDefault();
                  e.stopPropagation();
                  cancel();
                  return;
                }
                if ((e.metaKey || e.ctrlKey) && e.key === "Enter") {
                  e.preventDefault();
                  e.stopPropagation();
                  submit();
                }
              }}
            >
              <div class="text-fg-3 text-[11px] font-mono mb-1.5 truncate">
                <span class="bg-surface-3 text-fg px-1.5 py-0.5 rounded-sm mr-1.5">
                  selection
                </span>
                in {target().path}
              </div>
              <div class="border-l-2 border-edge pl-2 italic text-fg-2 text-[11px] mb-2 max-h-16 overflow-auto whitespace-pre-wrap break-words">
                "{target().locator.quote}"
              </div>
              <textarea
                ref={(el) => setTimeout(() => el?.focus(), 0)}
                value={body()}
                onInput={(e) => setBody(e.currentTarget.value)}
                placeholder="What should the agent change?"
                rows={3}
                class="w-full resize-y min-h-[60px] border border-edge rounded-sm px-2 py-1.5 font-sans text-[12px] bg-surface-0 text-fg placeholder:text-fg-3 focus:outline-none focus:ring-1 focus:ring-accent"
              />
              <div class="flex justify-end gap-1.5 mt-2">
                <button
                  type="button"
                  onClick={cancel}
                  class="px-2.5 py-1 text-[11px] rounded-sm border border-edge bg-surface-1 text-fg-2 hover:bg-surface-2"
                >
                  Cancel
                </button>
                <button
                  type="button"
                  onClick={submit}
                  class="px-2.5 py-1 text-[11px] rounded-sm border border-accent bg-accent text-surface-0 font-medium hover:opacity-90"
                >
                  Save (⌘↵)
                </button>
              </div>
            </div>
          </Portal>
        );
      }}
    </Show>
  );
};

export default CommentComposer;
