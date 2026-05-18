/** Shared composer popover. Reads `composerState` (singleton), renders
 *  when a target is set, writes the comment to `useComments` on Save.
 *  Mounted ONCE per CodeTab — any capture surface (text browse, branch
 *  diff, HTML iframe) routes through the same composer. */

import {
  type Component,
  createEffect,
  createSignal,
  onCleanup,
  Show,
} from "solid-js";
import { Portal } from "solid-js/web";
import { useComposer } from "./composerState";
import { useComments } from "./useComments";

const COMPOSER_WIDTH = 320;
const COMPOSER_GAP = 8;

/** Clamp the popover so it stays inside the viewport. The selection rect
 *  might be near the right or bottom edge — we place the popover just
 *  below and right of the rect, then pull it back if needed. */
function clampPosition(
  rect: { x: number; y: number; width: number; height: number },
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
  repoRoot: string;
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
    useComments(props.repoRoot).add({
      path: target.path,
      locator: target.locator,
      body: trimmed,
    });
    composer.close();
    setBody("");
  };

  const cancel = (): void => {
    composer.close();
    setBody("");
  };

  // kolu's global shortcut dispatcher (`useShortcuts.ts`) listens at
  // window-keydown with `{ capture: true }` — it fires BEFORE bubble-phase
  // React/Solid handlers and dispatches Cmd+Enter to "New terminal". A
  // bubble-phase `onKeyDown` on this component runs too late: the global
  // has already fired. Install our own capture-phase listener that wins
  // the race when the composer is open AND focus is inside it.
  createEffect(() => {
    if (!composer.target()) return;
    const onKey = (e: KeyboardEvent): void => {
      // Only intercept if focus is inside the composer — otherwise the
      // user is using kolu normally (e.g. terminal hotkeys) and we'd
      // capture-block every Cmd+Enter app-wide.
      const composerEl = document.querySelector(
        '[data-testid="kolu-comment-composer"]',
      );
      const active = document.activeElement;
      if (!composerEl || !active || !composerEl.contains(active)) return;
      if (e.key === "Escape") {
        e.preventDefault();
        e.stopImmediatePropagation();
        cancel();
      } else if ((e.metaKey || e.ctrlKey) && e.key === "Enter") {
        e.preventDefault();
        e.stopImmediatePropagation();
        submit();
      }
    };
    window.addEventListener("keydown", onKey, { capture: true });
    onCleanup(() => {
      window.removeEventListener("keydown", onKey, { capture: true });
    });
  });

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
              style={{
                position: "fixed",
                top: `${pos.top}px`,
                left: `${pos.left}px`,
                width: `${COMPOSER_WIDTH}px`,
                "z-index": "70",
              }}
              class="rounded-md border border-edge bg-surface-1 shadow-xl p-3 font-sans text-[12px]"
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
