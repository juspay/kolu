/** A failure's own words, as agents surfaces show them: the cause — who said
 *  it, then its first line — wrapped in FULL (a store path never pushes the
 *  panel wider, and a cut-off cause is no cause), and under it, when there is
 *  any, the evidence in the shared log-tail block: line breaks kept, long lines
 *  wrapped, a fixed height that scrolls, and Copy handing over the whole
 *  failure. The words are `@kolu/agent-distro/failure`'s convention, read by
 *  the status fold; this only draws them. Used by a machine's host details and
 *  by Settings' profile row. */

import type { AgentFailureCause } from "@kolu/agent-distro/status";
import { type LogLine, LogTail } from "@kolu/solid-logtail";
import { type Component, createMemo, Show } from "solid-js";
import { toast } from "solid-sonner";

/** Two tails are the same when every line is — so a fold re-minted on an
 *  unrelated tick (the host details' "3m ago") neither rebuilds the rows nor
 *  snaps a reader who scrolled up back to the bottom. */
function sameLines(a: readonly LogLine[], b: readonly LogLine[]): boolean {
  return a.length === b.length && a.every((l, i) => l.line === b[i]?.line);
}

const FailureWords: Component<{
  words: AgentFailureCause;
  /** `warn` where the agents still work (host details), `danger` where
   *  nothing does until it is fixed (Settings' profile row). */
  tone: "warn" | "danger";
  testid: string;
  /** Text scale and spacing — the call sites differ on these only. */
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
