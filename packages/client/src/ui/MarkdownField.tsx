/** A Markdown box with its preview under it — the one editor for free-form
 *  Markdown in the app: a terminal's intent and a Conductor memory both use
 *  it. Cmd/Ctrl+Enter submits. */

import { Markdown } from "@kolu/solid-markdown";
import type { Component } from "solid-js";

const MarkdownField: Component<{
  value: string;
  onInput: (value: string) => void;
  onSubmit: () => void;
  ref?: (el: HTMLTextAreaElement) => void;
  placeholder: string;
  label?: string;
  textareaTestId: string;
  previewTestId: string;
}> = (props) => (
  <>
    <textarea
      ref={props.ref}
      data-testid={props.textareaTestId}
      aria-label={props.label}
      value={props.value}
      onInput={(e) => props.onInput(e.currentTarget.value)}
      class="w-full min-h-32 resize-y rounded-md border border-edge bg-surface-0 px-3 py-2 font-mono text-[0.78rem] leading-relaxed text-fg outline-none placeholder:text-fg-3/60 focus:border-accent/70 focus:ring-2 focus:ring-accent/25"
      placeholder={props.placeholder}
      spellcheck={false}
      onKeyDown={(e) => {
        // `data-kolu-modal="true"` on the dialog makes `useShortcuts.ts` bail
        // before a global binding sees this; the stop is for any other
        // bubble-phase handler.
        if ((e.metaKey || e.ctrlKey) && e.key === "Enter") {
          e.preventDefault();
          e.stopPropagation();
          props.onSubmit();
        }
      }}
    />
    <div
      class="mt-2 min-h-14 max-h-32 overflow-y-auto rounded-md border border-edge/70 bg-surface-0/60 px-3 py-2 text-[0.72rem] leading-snug text-fg-2"
      data-testid={props.previewTestId}
    >
      <Markdown markdown={props.value} variant="compact" />
    </div>
  </>
);

export default MarkdownField;
