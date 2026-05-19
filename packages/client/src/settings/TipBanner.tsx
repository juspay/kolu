/** Top-center tip banner — a distinct surface for tips so they don't
 *  blend into the bottom-right toast stream (success / error / warning
 *  notifications). Pure animation surface; `useTips` owns when a tip
 *  becomes active and when it auto-dismisses. */

import {
  type Component,
  createEffect,
  createSignal,
  on,
  onCleanup,
  Show,
} from "solid-js";
import { Portal } from "solid-js/web";
import { CloseIcon } from "../ui/Icons";
import { activeTip, dismissTip } from "./useTips";

const TipBanner: Component = () => {
  const [visible, setVisible] = createSignal(false);

  createEffect(
    on(activeTip, (tip) => {
      // <Show> unmounts the DOM when tip is null — nothing to animate out.
      if (!tip) return;
      // Start off-screen, then flip on next frame so the CSS transition
      // runs instead of snapping straight to the final position.
      setVisible(false);
      const raf = requestAnimationFrame(() => setVisible(true));
      onCleanup(() => cancelAnimationFrame(raf));
    }),
  );

  return (
    <Show when={activeTip()}>
      {(tip) => (
        <Portal>
          <div
            data-testid="tip-banner"
            class="fixed top-3 left-1/2 z-50 -translate-x-1/2 pointer-events-none transition-all duration-300 ease-out"
            classList={{
              "opacity-0 -translate-y-6": !visible(),
              "opacity-100 translate-y-0": visible(),
            }}
          >
            <div
              class="pointer-events-auto flex items-center gap-3 pl-4 pr-2 py-2 bg-surface-1 border border-accent/50 rounded-full max-w-[min(560px,calc(100vw-2rem))]"
              style={{
                "box-shadow":
                  "0 10px 30px -10px rgba(0,0,0,0.5), 0 0 0 4px color-mix(in oklch, var(--color-accent) 12%, transparent)",
              }}
            >
              <span
                class="text-base leading-none select-none"
                aria-hidden="true"
              >
                💡
              </span>
              <span class="text-sm text-fg">{tip().text}</span>
              <button
                type="button"
                data-testid="tip-banner-dismiss"
                onClick={dismissTip}
                aria-label="Dismiss tip"
                class="h-6 w-6 flex items-center justify-center text-fg-3 hover:text-fg hover:bg-surface-2 rounded-full transition-colors cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/50"
              >
                <CloseIcon />
              </button>
            </div>
          </div>
        </Portal>
      )}
    </Show>
  );
};

export default TipBanner;
