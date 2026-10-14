/** The log-tail block every surface that shows raw host output wears.
 *
 *  Four behaviours, not just a few class names, and a consumer wants all four
 *  or none of them:
 *
 *   1. Every line WRAPS (`LOG_TAIL_LINE`), so a long line is read whole instead
 *      of being clipped at the block's edge.
 *   2. The block copies the WHOLE log it was handed — not the visible tail —
 *      because the reason a person reaches for Copy is the lines the block had
 *      to hide. The write goes through `./clipboard`'s `writeTextToClipboard`,
 *      which survives a non-secure context.
 *   3. The newest line stays in view as lines arrive, and the block stops
 *      following the moment the reader scrolls up to read something older.
 *   4. The corner Copy button confirms in place ("copied", the same 1500ms the
 *      rest of kolu's copy affordances flash for) and hands a FAILURE to
 *      {@link LogTailProps.onCopyError} — a copy that did not happen is never
 *      reported as one.
 *
 *  What each consumer still owns is `class` — sizing, scrolling and text scale —
 *  and what a failed copy says. Sizing is a real difference (a canvas overlay, a
 *  card, and a popover are three sizes); a toast is a real difference (a library
 *  cannot decide an app's notification policy, and dragging a toast library into
 *  this package would drag it into every consumer). */

import { type Cause, Effect } from "effect";
import {
  type Component,
  createEffect,
  createSignal,
  Index,
  onCleanup,
} from "solid-js";
import { writeTextToClipboard } from "./clipboard";
import { LOG_TAIL_LINE, LOG_TAIL_SURFACE, type LogLine } from "./logTailChrome";

/** How long the button says "copied" — the same 1500ms kolu's canonical copy
 *  affordance (`CopyCommandButton`) flashes, so two copy buttons in one app do
 *  not confirm at two different speeds. */
const COPIED_FLASH_MS = 1500;

/** The sentence a failed write reports. `writeTextToClipboard` fails with
 *  `Cause.UnknownError`, whose own `message` is Effect's generic wrapper text and
 *  whose `cause` (inherited from `Error`) is the real failure — so the cause is
 *  what a person needs to read: "clipboard access blocked", not "An error
 *  occurred in Effect.try". */
const failureMessage = (error: Cause.UnknownError): string => {
  const cause: unknown = error.cause;
  return cause instanceof Error ? cause.message : String(cause);
};

export interface LogTailProps {
  /** The rows to render — as many as the consumer chose to show (a tail). */
  lines: readonly LogLine[];
  /** The whole retained log this attempt produced — what the Copy button writes.
   *  Kept separate from `lines` because a tail is a WINDOW onto it: copying the
   *  window would hide exactly the output the reader wanted the button for. */
  log: readonly LogLine[];
  /** The block's test handle (each surface names its own). */
  testid: string;
  /** Sizing, overflow and text scale — the one thing the call sites legitimately
   *  differ on. Chrome (surface, wrap, corner button) is not negotiable and is
   *  not a prop. */
  class?: string;
  /** What to say when the clipboard write fails — the one part of this affordance
   *  this package cannot decide. REQUIRED, and handed the failure's own sentence:
   *  a caller with nothing to say passes a no-op explicitly rather than letting a
   *  copy that did not happen look like one that did. */
  onCopyError: (message: string) => void;
}

export const LogTail: Component<LogTailProps> = (props) => {
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
    // Tracked read: a consumer hands a FRESH array from its memo exactly when
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
    // inside the user-activation window (see `./clipboard`). It takes the FULL
    // `log`, never the visible tail — the lines the block had to hide are the
    // ones a person reaches for Copy for.
    const text = props.log.map((line) => line.line).join("\n");
    // Run here rather than through the app's own effect edge: this package is a
    // leaf, and the write is the one thing it owns end to end. A failure is the
    // consumer's to present, with the failure's own sentence.
    void Effect.runPromise(writeTextToClipboard(text)).then(
      flashCopied,
      (error) => props.onCopyError(failureMessage(error)),
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
        // `pr-12` reserves the corner the button occupies, so the first visible
        // row's own text never runs underneath it on a long line.
        class={`${LOG_TAIL_SURFACE} w-full pr-12 ${props.class ?? ""}`}
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
