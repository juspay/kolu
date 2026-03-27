/** Shared SVG icons — deduplicated so identical markup stays in sync. */

import type { Component } from "solid-js";

/** Lightning-bolt icon indicating a git worktree. */
export const WorktreeIcon: Component<{ class?: string }> = (props) => (
  <svg
    class={props.class ?? "w-3 h-3"}
    fill="none"
    stroke="currentColor"
    viewBox="0 0 24 24"
  >
    <path
      stroke-linecap="round"
      stroke-linejoin="round"
      stroke-width="2"
      d="M13 10V3L4 14h7v7l9-11h-7z"
    />
  </svg>
);
