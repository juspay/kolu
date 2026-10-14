/** The log-tail block every surface that shows raw host output wears.
 *
 *  Three surfaces render a tail — the connect overlay (`ConnectCanvas`), the boot
 *  stalled card (`CanvasFailureCard`, on behalf of `BootStalledCanvas`), and the
 *  host-diagnostics popover — and they share FOUR behaviours, not just a few
 *  class names:
 *
 *   1. Every line WRAPS (`LOG_TAIL_LINE`), so a long Nix line is read whole
 *      instead of being clipped at the block's edge.
 *   2. The block copies the WHOLE log the attempt produced — not the visible
 *      tail — because the reason a person reaches for Copy is the lines the
 *      block had to hide.
 *   3. The newest line stays in view as lines arrive, and the block stops
 *      following the moment the reader scrolls up to read something older.
 *   4. The corner Copy button is the same affordance everywhere: a click
 *      writes, the label flips to "copied" for a moment, and a failure surfaces
 *      as a toast (the `writeTextToClipboard` contract — it FAILS rather than
 *      silently no-op'ing, so the write is what the label reports).
 *
 *  What each site still owns is `class` — sizing, scrolling and text scale. The
 *  connect overlay is a fixed-height canvas block that pins its newest line to
 *  the bottom; the card and the popover are `max-h-*` scrollers at two different
 *  scales. That is a real difference (three surfaces, three sizes) and it stays
 *  at the call site; everything above is named once, here. */

import { toError } from "@kolu/surface/run-stream";
import { Effect } from "effect";
import {
  type Component,
  createEffect,
  createSignal,
  Index,
  onCleanup,
} from "solid-js";
import { toast } from "solid-sonner";
import { runAction } from "../runAction";
import { writeTextToClipboard } from "./clipboard";
import { LOG_TAIL_LINE, LOG_TAIL_SURFACE, type LogLine } from "./logTailChrome";

/** How long the button says "copied" — the same 1500ms the canonical copy
 *  affordance (`CopyCommandButton`) flashes, so two copy buttons in one app do
 *  not confirm at two different speeds. */
const COPIED_FLASH_MS = 1500;

const LogTail: Component<{
  /** The rows to render — as many as this surface chose to show (a tail). */
  lines: readonly LogLine[];
  /** The whole retained log this attempt produced — what the Copy button writes.
   *  Kept separate from `lines` because a tail is a WINDOW onto it: copying the
   *  window would hide exactly the output the reader wanted the button for. */
  log: readonly LogLine[];
  /** The block's test handle (each surface names its own). */
  testid: string;
  /** Sizing, overflow and text scale — the one thing the three call sites
   *  legitimately differ on. Chrome (surface, wrap, corner button) is not
   *  negotiable and is not a prop. */
  class?: string;
}> = (props) => {
  let box: HTMLDivElement | undefined;
  const [copied, setCopied] = createSignal(false);
  // Whether the newest row is the one in view. Starts TRUE so a freshly mounted
  // block begins pinned; only a reader scrolling up un-pins it, and scrolling
  // back to the bottom re-pins it.
  const [pinned, setPinned] = createSignal(true);

  // A cancel slot, not a stack: a rapid re-click restarts the flash instead of
  // racing two timeouts, and an unmount mid-flash cancels it.
  let cancelFlash: (() => void) | undefined;
  onCleanup(() => cancelFlash?.());
  const flashCopied = () => {
    setCopied(true);
    cancelFlash?.();
    const timer = setTimeout(() => setCopied(false), COPIED_FLASH_MS);
    cancelFlash = () => clearTimeout(timer);
  };

  // Follow the newest line while the reader is at the bottom; leave the view
  // exactly where a reader who scrolled up put it.
  createEffect(() => {
    // Tracked read: every caller hands a FRESH array from its memo exactly when
    // the tail changed, so this re-runs on a new line whether the block is still
    // filling its depth or already sliding at a fixed one.
    const lines = props.lines;
    if (lines.length > 0 && pinned() && box !== undefined) {
      box.scrollTop = box.scrollHeight;
    }
  });

  const copy = () => {
    // Built BEFORE the write, synchronously in the click handler: the
    // `execCommand` fallback `writeTextToClipboard` may take is only legal
    // inside the user-activation window (see `ui/clipboard.ts`). It takes the
    // FULL `log`, never the visible tail — the lines the block had to hide are
    // the ones a person reaches for Copy for.
    const text = props.log.map((line) => line.line).join("\n");
    runAction(
      "copy log",
      writeTextToClipboard(text).pipe(
        Effect.tap(() => Effect.sync(flashCopied)),
        Effect.catch((err) =>
          Effect.sync(() => {
            toast.error(`Couldn't copy the log: ${toError(err).message}`);
          }),
        ),
      ),
    );
  };

  return (
    <div class="relative">
      <div
        ref={box}
        data-testid={props.testid}
        // Purely a re-pin trigger: the effect above decides, off `pinned()`,
        // whether a scroll event should stop the follow or resume it. The 2px
        // slack absorbs sub-pixel scroll offsets (a fractional device pixel
        // ratio leaves `scrollTop` a hair short of the exact bottom), which
        // would otherwise un-pin a tail that IS at the bottom.
        onScroll={() => {
          const el = box;
          if (el !== undefined) {
            setPinned(el.scrollHeight - el.scrollTop - el.clientHeight <= 2);
          }
        }}
        class={`${LOG_TAIL_SURFACE} w-full ${props.class ?? ""}`}
      >
        <Index each={props.lines}>
          {(entry) => <div class={LOG_TAIL_LINE}>{entry().line}</div>}
        </Index>
      </div>
      {/* In the block's corner, and OUTSIDE the scroller so it cannot scroll
          away. A real <button>, so it is tab-reachable like any other control. */}
      <button
        type="button"
        data-testid={`${props.testid}-copy`}
        onClick={copy}
        title="Copy the full log for this attempt"
        class="absolute right-1 top-1 rounded bg-bg-2/90 px-1.5 py-0.5 text-[10px] leading-4 text-fg-4 hover:bg-surface-3 hover:text-fg transition-colors cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/50"
      >
        {copied() ? "copied" : "Copy"}
      </button>
    </div>
  );
};

export default LogTail;
