/** The forge marks the PR pip draws — a registry module, not inline SVG.
 *
 *  They live apart from the component for the same reason kolu keeps its icons
 *  in one place and this PR emptied these three OUT of `client/src/ui/Icons.tsx`:
 *  an icon is a named, reusable mark, and a mark defined inside the one
 *  component that happens to draw it today is the shape that gets copy-pasted
 *  the second time somebody needs it. Nothing else in the repo drew them, which
 *  is why they came here rather than staying — but "one consumer" is a fact
 *  about today, not a reason to inline.
 *
 *  GitHub's own Octicons geometry, 16×16, `currentColor` fill — the colour is
 *  the caller's (`PrStateIcon` paints per PR state). */

import type { Component } from "solid-js";

const GitMergeIcon: Component<{ class: string }> = (props) => (
  <svg
    class={props.class}
    viewBox="0 0 16 16"
    fill="currentColor"
    aria-hidden="true"
  >
    <path d="M5 3.254V3.25v.005a.75.75 0 1 1 0-.005v.004zm.45 1.9a2.25 2.25 0 1 0-1.95.218v5.256a2.25 2.25 0 1 0 1.5 0V7.121A5.69 5.69 0 0 0 9.5 9.5a3.5 3.5 0 0 0 3.5-3.5V5.314a2.25 2.25 0 1 0-1.5 0V6a2 2 0 0 1-2 2A4.19 4.19 0 0 1 5.45 5.154zM4.25 12a.75.75 0 1 1 0 1.501.75.75 0 0 1 0-1.5zM12.25 2.5a.75.75 0 1 1 0 1.5.75.75 0 0 1 0-1.5z" />
  </svg>
);

const GitPullRequestClosedIcon: Component<{ class: string }> = (props) => (
  <svg
    class={props.class}
    viewBox="0 0 16 16"
    fill="currentColor"
    aria-hidden="true"
  >
    <path d="M3.25 1A2.25 2.25 0 0 1 4 5.372v5.256a2.25 2.25 0 1 1-1.5 0V5.372A2.25 2.25 0 0 1 3.25 1zm9.5 5.5a.75.75 0 0 1 .75.75v3.378a2.25 2.25 0 1 1-1.5 0V7.25a.75.75 0 0 1 .75-.75zm-2.03-5.28a.751.751 0 0 1 1.042-.018.751.751 0 0 1 .018 1.042L10.56 3.5l1.22 1.256a.751.751 0 0 1-.018 1.042.751.751 0 0 1-1.042.018L9.464 4.53a.75.75 0 0 1 0-1.06zM3.25 2.5a.75.75 0 1 0 0 1.5.75.75 0 0 0 0-1.5zM3.25 12a.75.75 0 1 0 0 1.5.75.75 0 0 0 0-1.5zm9.5 0a.75.75 0 1 0 0 1.5.75.75 0 0 0 0-1.5z" />
  </svg>
);

const GitPullRequestIcon: Component<{ class: string }> = (props) => (
  <svg
    class={props.class}
    viewBox="0 0 16 16"
    fill="currentColor"
    aria-hidden="true"
  >
    <path d="M1.5 3.25a2.25 2.25 0 1 1 3 2.122v5.256a2.25 2.25 0 1 1-1.5 0V5.372A2.25 2.25 0 0 1 1.5 3.25zm5.677-.177L9.573.677A.25.25 0 0 1 10 .854V2.5h1A2.5 2.5 0 0 1 13.5 5v5.628a2.25 2.25 0 1 1-1.5 0V5a1 1 0 0 0-1-1h-1v1.646a.25.25 0 0 1-.427.177L7.177 3.427a.25.25 0 0 1 0-.354zM3.75 2.5a.75.75 0 1 0 0 1.5.75.75 0 0 0 0-1.5zm0 9.5a.75.75 0 1 0 0 1.5.75.75 0 0 0 0-1.5zm8.25.75a.75.75 0 1 0 1.5 0 .75.75 0 0 0-1.5 0z" />
  </svg>
);

export { GitMergeIcon, GitPullRequestClosedIcon, GitPullRequestIcon };
