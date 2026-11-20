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

/** The ONE empty tail a consumer reaches for — a shared reference, so a site
 *  with no output hands this component the SAME array on every re-resolve
 *  instead of a fresh `[]` literal. */
export const NO_LOG_LINES: readonly LogLine[] = [];

const LOG_TAIL_SURFACE =
  "rounded border border-bd-1/50 bg-bg-2/40 font-mono text-fg-4";
const LOG_TAIL_LINE = "whitespace-pre-wrap break-words";

const COPIED_FLASH_MS = 1500;
const SCROLL_BOTTOM_SLACK_PX = 2;

const createFlash = (ms: number): [() => boolean, () => void] => {
  const [lit, setLit] = createSignal(false);
  let cancel: (() => void) | undefined;
  onCleanup(() => cancel?.());
  return [
    lit,
    () => {
      cancel?.();
      setLit(true);
      const timer = setTimeout(() => setLit(false), ms);
      cancel = () => clearTimeout(timer);
    },
  ];
};

export interface LogTailProps {
  /** The rows to render — as many as the consumer chose to show (a tail). */
  lines: readonly LogLine[];
  /** The log to copy: everything the CALLER retained for this attempt — the
   *  tail is a WINDOW onto it. */
  log: readonly LogLine[];
  /** The block's test handle (each surface names its own). */
  testid: string;
  /** Sizing, overflow and text scale. Chrome (surface, wrap, corner button) is
   *  not a prop. */
  class?: string;
  /** What to say when the clipboard write fails. REQUIRED, handed the failure's
   *  own sentence, and called only for a write that did not happen. */
  onCopyError: (message: string) => void;
}

export const LogTail: Component<LogTailProps> = (props) => {
  let box: HTMLDivElement | undefined;
  const [copied, flashCopied] = createFlash(COPIED_FLASH_MS);
  const [follow, setFollow] = createSignal<"newest" | "reader">("newest");

  createEffect(() => {
    const lines = props.lines;
    if (lines.length > 0 && follow() === "newest" && box !== undefined) {
      box.scrollTop = box.scrollHeight;
    }
  });

  const copy = () => {
    const text = props.log.map((line) => line.line).join("\n");
    void Effect.runPromise(writeTextToClipboard(text)).then(
      flashCopied,
      (error: Cause.UnknownError) => props.onCopyError(error.message),
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
            setFollow(
              el.scrollHeight - el.scrollTop - el.clientHeight <=
                SCROLL_BOTTOM_SLACK_PX
                ? "newest"
                : "reader",
            );
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
