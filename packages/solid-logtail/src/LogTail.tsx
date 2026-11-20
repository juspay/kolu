import { type Cause, Effect } from "effect";
import {
  type Component,
  createEffect,
  createSignal,
  Index,
  onCleanup,
} from "solid-js";
import { writeTextToClipboard } from "./clipboard";

/** One line of retained output, structurally — a caller hands it whatever tail
 *  it kept. */
export type LogLine = { readonly line: string };

/** The ONE empty tail a consumer reaches for — a shared reference so a site with
 *  no output to narrate hands this component the SAME array across every
 *  re-resolve/repaint instead of a fresh `[]` literal (which would churn
 *  identity-keyed DOM on every tick even though nothing changed). */
export const NO_LOG_LINES: readonly LogLine[] = [];

const LOG_TAIL_SURFACE =
  "rounded border border-bd-1/50 bg-bg-2/40 font-mono text-fg-4";
const LOG_TAIL_LINE = "whitespace-pre-wrap break-words";

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
  /** The log to copy: everything the CALLER retained for this attempt — the
   *  tail is a WINDOW onto it, so copying the window would hide exactly the
   *  output the reader wanted the button for. Handed here rather than derived
   *  because how much is kept is the caller's decision (kolu's session retains a
   *  bounded tail of the host's output, not a whole transcript). */
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
  const [pinned, setPinned] = createSignal(true);

  let cancelFlash: (() => void) | undefined;
  onCleanup(() => cancelFlash?.());
  const flashCopied = () => {
    setCopied(true);
    cancelFlash?.();
    const timer = setTimeout(() => setCopied(false), COPIED_FLASH_MS);
    cancelFlash = () => clearTimeout(timer);
  };

  createEffect(() => {
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
        onScroll={() => {
          const el = box;
          if (el !== undefined) {
            setPinned(el.scrollHeight - el.scrollTop - el.clientHeight <= 2);
          }
        }}
        class={`${LOG_TAIL_SURFACE} w-full pr-12 ${props.class ?? ""}`}
      >
        <Index each={props.lines}>
          {(entry) => <div class={LOG_TAIL_LINE}>{entry().line}</div>}
        </Index>
      </div>
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
