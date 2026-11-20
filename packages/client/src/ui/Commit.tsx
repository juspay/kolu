import { isCleanRef } from "@kolu/surface-app";
import { type Component, Show } from "solid-js";

/** The GitHub base for every kolu source link (commit pages, path histories). */
export const REPO_URL = "https://github.com/juspay/kolu";

const Commit: Component<{ sha: string | undefined; class?: string }> = (
  props,
) => {
  const linkable = () => isCleanRef(props.sha);
  return (
    <Show
      when={linkable()}
      fallback={<span class="text-fg-2">{props.sha || "—"}</span>}
    >
      <a
        href={`${REPO_URL}/commit/${props.sha}`}
        target="_blank"
        rel="noopener noreferrer"
        class={
          props.class ??
          "text-fg-2 underline decoration-dotted underline-offset-2 hover:text-fg"
        }
      >
        {props.sha}
      </a>
    </Show>
  );
};

export default Commit;
