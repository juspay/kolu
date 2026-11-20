import type { AgentFailureCause } from "@kolu/agent-distro/status";
import { type LogLine, LogTail } from "@kolu/solid-logtail";
import { type Component, createMemo, Show } from "solid-js";
import { toast } from "solid-sonner";

function sameLines(a: readonly LogLine[], b: readonly LogLine[]): boolean {
  return a.length === b.length && a.every((l, i) => l.line === b[i]?.line);
}

const FailureWords: Component<{
  words: AgentFailureCause;
  tone: "warn" | "danger";
  testid: string;
  class?: string;
}> = (props) => {
  const cause = () =>
    props.words.by === undefined
      ? props.words.headline
      : `${props.words.by}: ${props.words.headline}`;
  const lines = createMemo(
    () => props.words.detail.map((line) => ({ line })),
    undefined,
    { equals: sameLines },
  );
  const log = createMemo(() => [{ line: cause() }, ...lines()], undefined, {
    equals: sameLines,
  });
  return (
    <div data-testid={props.testid} class={props.class}>
      <p
        data-testid={`${props.testid}-text`}
        class="wrap-anywhere"
        classList={{
          "text-warning": props.tone === "warn",
          "text-danger": props.tone === "danger",
        }}
      >
        {cause()}
      </p>
      <Show when={lines().length > 0}>
        <LogTail
          testid={`${props.testid}-detail`}
          lines={lines()}
          log={log()}
          class="mt-1 max-h-32 overflow-y-auto px-1.5 py-1 font-mono text-[10px] leading-4"
          onCopyError={(message) =>
            toast.error(`Failed to copy the failure: ${message}`)
          }
        />
      </Show>
    </div>
  );
};

export default FailureWords;
