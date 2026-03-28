/**
 * Shared SVG icon components — centralized so markup stays in sync.
 * Each icon takes an optional `class` prop (defaults to a sensible size).
 * Keep alphabetically sorted when adding new icons.
 */

import { type Component, Switch, Match } from "solid-js";

export const ChevronDownIcon: Component<{ class?: string }> = (props) => (
  <svg
    class={props.class ?? "w-3.5 h-3.5"}
    viewBox="0 0 16 16"
    fill="none"
    stroke="currentColor"
    stroke-width="2"
    stroke-linecap="round"
  >
    <path d="M4 6L8 10L12 6" />
  </svg>
);

export const ChevronUpIcon: Component<{ class?: string }> = (props) => (
  <svg
    class={props.class ?? "w-3.5 h-3.5"}
    viewBox="0 0 16 16"
    fill="none"
    stroke="currentColor"
    stroke-width="2"
    stroke-linecap="round"
  >
    <path d="M12 10L8 6L4 10" />
  </svg>
);

export const CloseIcon: Component<{ class?: string }> = (props) => (
  <svg
    class={props.class ?? "w-3.5 h-3.5"}
    viewBox="0 0 16 16"
    fill="none"
    stroke="currentColor"
    stroke-width="2"
    stroke-linecap="round"
  >
    <path d="M4 4L12 12M12 4L4 12" />
  </svg>
);

export const GitMergeIcon: Component<{ class?: string }> = (props) => (
  <svg
    class={props.class ?? "w-3.5 h-3.5"}
    viewBox="0 0 16 16"
    fill="currentColor"
  >
    <path d="M5 3.254V3.25v.005a.75.75 0 1 1 0-.005v.004zm.45 1.9a2.25 2.25 0 1 0-1.95.218v5.256a2.25 2.25 0 1 0 1.5 0V7.121A5.69 5.69 0 0 0 9.5 9.5a3.5 3.5 0 0 0 3.5-3.5V5.314a2.25 2.25 0 1 0-1.5 0V6a2 2 0 0 1-2 2A4.19 4.19 0 0 1 5.45 5.154zM4.25 12a.75.75 0 1 1 0 1.501.75.75 0 0 1 0-1.5zM12.25 2.5a.75.75 0 1 1 0 1.5.75.75 0 0 1 0-1.5z" />
  </svg>
);

export const GitPullRequestClosedIcon: Component<{ class?: string }> = (
  props,
) => (
  <svg
    class={props.class ?? "w-3.5 h-3.5"}
    viewBox="0 0 16 16"
    fill="currentColor"
  >
    <path d="M3.25 1A2.25 2.25 0 0 1 4 5.372v5.256a2.25 2.25 0 1 1-1.5 0V5.372A2.25 2.25 0 0 1 3.25 1zm9.5 5.5a.75.75 0 0 1 .75.75v3.378a2.25 2.25 0 1 1-1.5 0V7.25a.75.75 0 0 1 .75-.75zm-2.03-5.28a.751.751 0 0 1 1.042-.018.751.751 0 0 1 .018 1.042L10.56 3.5l1.22 1.256a.751.751 0 0 1-.018 1.042.751.751 0 0 1-1.042.018L9.464 4.53a.75.75 0 0 1 0-1.06zM3.25 2.5a.75.75 0 1 0 0 1.5.75.75 0 0 0 0-1.5zM3.25 12a.75.75 0 1 0 0 1.5.75.75 0 0 0 0-1.5zm9.5 0a.75.75 0 1 0 0 1.5.75.75 0 0 0 0-1.5z" />
  </svg>
);

export const GitPullRequestIcon: Component<{ class?: string }> = (props) => (
  <svg
    class={props.class ?? "w-3.5 h-3.5"}
    viewBox="0 0 16 16"
    fill="currentColor"
  >
    <path d="M1.5 3.25a2.25 2.25 0 1 1 3 2.122v5.256a2.25 2.25 0 1 1-1.5 0V5.372A2.25 2.25 0 0 1 1.5 3.25zm5.677-.177L9.573.677A.25.25 0 0 1 10 .854V2.5h1A2.5 2.5 0 0 1 13.5 5v5.628a2.25 2.25 0 1 1-1.5 0V5a1 1 0 0 0-1-1h-1v1.646a.25.25 0 0 1-.427.177L7.177 3.427a.25.25 0 0 1 0-.354zM3.75 2.5a.75.75 0 1 0 0 1.5.75.75 0 0 0 0-1.5zm0 9.5a.75.75 0 1 0 0 1.5.75.75 0 0 0 0-1.5zm8.25.75a.75.75 0 1 0 1.5 0 .75.75 0 0 0-1.5 0z" />
  </svg>
);

export const GridIcon: Component<{ class?: string }> = (props) => (
  <svg
    class={props.class ?? "w-4 h-4"}
    fill="none"
    stroke="currentColor"
    viewBox="0 0 24 24"
  >
    <path
      stroke-linecap="round"
      stroke-linejoin="round"
      stroke-width="2"
      d="M4 5a1 1 0 011-1h4a1 1 0 011 1v4a1 1 0 01-1 1H5a1 1 0 01-1-1V5zM14 5a1 1 0 011-1h4a1 1 0 011 1v4a1 1 0 01-1 1h-4a1 1 0 01-1-1V5zM4 15a1 1 0 011-1h4a1 1 0 011 1v4a1 1 0 01-1 1H5a1 1 0 01-1-1v-4zM14 15a1 1 0 011-1h4a1 1 0 011 1v4a1 1 0 01-1 1h-4a1 1 0 01-1-1v-4z"
    />
  </svg>
);

export const MenuIcon: Component<{ class?: string }> = (props) => (
  <svg
    class={props.class ?? "w-5 h-5"}
    fill="none"
    stroke="currentColor"
    viewBox="0 0 24 24"
  >
    <path
      stroke-linecap="round"
      stroke-linejoin="round"
      stroke-width="2"
      d="M4 6h16M4 12h16M4 18h16"
    />
  </svg>
);

export const ScrollDownIcon: Component<{ class?: string }> = (props) => (
  <svg
    class={props.class ?? "w-5 h-5"}
    fill="none"
    stroke="currentColor"
    viewBox="0 0 24 24"
  >
    <path
      stroke-linecap="round"
      stroke-linejoin="round"
      stroke-width="2"
      d="M19 14l-7 7m0 0l-7-7m7 7V3"
    />
  </svg>
);

export const SearchIcon: Component<{ class?: string }> = (props) => (
  <svg
    class={props.class ?? "w-4 h-4"}
    fill="none"
    stroke="currentColor"
    viewBox="0 0 24 24"
  >
    <path
      stroke-linecap="round"
      stroke-linejoin="round"
      stroke-width="2"
      d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z"
    />
  </svg>
);

export const SettingsIcon: Component<{ class?: string }> = (props) => (
  <svg
    class={props.class ?? "w-4 h-4"}
    fill="none"
    stroke="currentColor"
    viewBox="0 0 24 24"
  >
    <path
      stroke-linecap="round"
      stroke-linejoin="round"
      stroke-width="2"
      d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.066 2.573c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.573 1.066c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.066-2.573c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z"
    />
    <path
      stroke-linecap="round"
      stroke-linejoin="round"
      stroke-width="2"
      d="M15 12a3 3 0 11-6 0 3 3 0 016 0z"
    />
  </svg>
);

/** PR state icon — green for open, purple for merged, red for closed. */
export const PrStateIcon: Component<{
  state: "open" | "closed" | "merged";
  class?: string;
}> = (props) => {
  const size = () => props.class ?? "w-3.5 h-3.5";
  return (
    <Switch>
      <Match when={props.state === "merged"}>
        <span class="text-purple-400 shrink-0">
          <GitMergeIcon class={size()} />
        </span>
      </Match>
      <Match when={props.state === "closed"}>
        <span class="text-danger shrink-0">
          <GitPullRequestClosedIcon class={size()} />
        </span>
      </Match>
      <Match when={props.state === "open"}>
        <span class="text-ok shrink-0">
          <GitPullRequestIcon class={size()} />
        </span>
      </Match>
    </Switch>
  );
};

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
