/** A git-commit cell: renders the short SHA as a link to its GitHub commit
 *  page when the ref is clean and navigable, and as plain text otherwise (a
 *  dirty / dev / absent ref — never a broken `/commit/<sha>-dirty` link).
 *  Shared by the ChromeBar identity rail (the server / pty-host commit) and the
 *  About dialog (the client build commit) so the linkable guard can't drift
 *  between the two call sites. */

import { type Component, Show } from "solid-js";

const REPO_URL = "https://github.com/juspay/kolu";

const Commit: Component<{ sha: string | undefined; class?: string }> = (
  props,
) => {
  const linkable = () => {
    const c = props.sha;
    return !!c && c !== "dev" && !c.includes("-dirty");
  };
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
