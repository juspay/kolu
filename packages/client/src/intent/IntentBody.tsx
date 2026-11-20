import { type Component, Show } from "solid-js";
import { IntentMarkdownBlock } from "./IntentMarkdown";
import { intentBodyMarkdown } from "./text";

const IntentBody: Component<{
  intent: string | undefined;
  testId?: string;
}> = (props) => (
  <Show when={intentBodyMarkdown(props.intent)}>
    {(b) => (
      <div
        data-testid={props.testId}
        class="mt-2 rounded-md border border-edge/70 bg-surface-2/35 px-2 py-1.5 text-[0.72rem] leading-snug text-fg-2"
      >
        <IntentMarkdownBlock markdown={b()} />
      </div>
    )}
  </Show>
);

export default IntentBody;
