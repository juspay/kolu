/** The canonical "copy-this-command" affordance: a full-width button showing a
 *  monospace command that copies it on click, flips the trailing label to
 *  "copied" for 1500ms, and toasts on failure. One place to change the copy
 *  interaction — `KavalAttachSection` and `PrUnavailablePopover`'s recovery
 *  hint both compose this rather than re-hand-rolling the signal + timeout +
 *  `writeTextToClipboard` + `toast.error` sequence.
 *
 *  `writeTextToClipboard` fires synchronously at the top of the click handler,
 *  before `setCopied(true)`, so the clipboard write stays inside the
 *  user-activation gesture window (see clipboard.ts:28-34). */

import {
  type Component,
  type JSX,
  createSignal,
  onCleanup,
  Show,
} from "solid-js";
import { toast } from "solid-sonner";
import { writeTextToClipboard } from "./clipboard";

const CopyCommandButton: Component<{
  /** Command shown in the button (and copied, unless `copyText` overrides). */
  command: string;
  /** Text actually written to the clipboard. Defaults to `command`. */
  copyText?: string;
  /** Hover/`title` fallback — e.g. the full form when `command` is abbreviated. */
  title?: string;
  testId?: string;
  /** Trailing affordance shown when idle. Defaults to the word "copy". */
  idle?: JSX.Element;
  /** Corner radius utility. Defaults to `rounded-lg`. */
  rounded?: string;
}> = (props) => {
  const [copied, setCopied] = createSignal(false);

  // Flash "copied" for 1500ms. The timer is tracked so a rapid re-click resets
  // it instead of stacking timers, and a mid-flash unmount cancels it rather
  // than firing setCopied on a disposed owner (clearTimeout(undefined) is a
  // safe no-op).
  let resetTimer: ReturnType<typeof setTimeout> | undefined;
  const flashCopied = () => {
    setCopied(true);
    clearTimeout(resetTimer);
    resetTimer = setTimeout(() => setCopied(false), 1500);
  };
  onCleanup(() => clearTimeout(resetTimer));

  // Fire the clipboard write first, inside the gesture, then flash "copied".
  const copy = () => {
    writeTextToClipboard(props.copyText ?? props.command)
      .then(flashCopied)
      .catch((err: Error) => toast.error(`Couldn't copy: ${err.message}`));
  };

  return (
    <button
      type="button"
      data-testid={props.testId}
      onClick={copy}
      title={props.title}
      class={`w-full flex items-center justify-between gap-2 px-2 py-1.5 ${props.rounded ?? "rounded-lg"} bg-surface-2 hover:bg-surface-3 font-mono text-[11px] text-fg cursor-pointer transition-colors`}
    >
      <span class="truncate">{props.command}</span>
      <span class="shrink-0 flex items-center gap-1 text-fg-3 text-[10px]">
        <Show when={copied()} fallback={props.idle ?? "copy"}>
          copied
        </Show>
      </span>
    </button>
  );
};

export default CopyCommandButton;
