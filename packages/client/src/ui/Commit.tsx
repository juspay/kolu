/** A git-commit cell: renders the short SHA as a link to its GitHub commit
 *  page when the ref is clean and navigable, and as plain text otherwise (a
 *  dirty / dev / absent ref — never a broken `/commit/<sha>-dirty` link).
 *  Shared by the ChromeBar identity rail (the server / pty-host commit) and the
 *  About dialog (the client build commit) so the linkable guard can't drift
 *  between the two call sites. */

import { isCleanRef } from "@kolu/surface-app";
import { type Component, Show } from "solid-js";

/** The GitHub base for every kolu source link (commit pages, path histories).
 *  Exported so the kaval dialog's "what changed in kaval" link builds a
 *  `commits/<ref>/packages/kaval` URL against the same base this component uses
 *  for `/commit/<sha>` — one repo base, no drift. */
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
