/**
 * Shared SVG icon components.
 *
 * All reusable icons live here so identical markup stays in sync across the
 * app. Each icon accepts an optional `class` prop (falls back to a sensible
 * default size). When adding a new icon, follow the same pattern and keep
 * icons alphabetically sorted.
 */

import type { Component } from "solid-js";

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
