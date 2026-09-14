/**
 * Shared SVG icon components — centralized so markup stays in sync.
 * Each icon takes an optional `class` prop (defaults to a sensible size).
 * Keep alphabetically sorted when adding new icons.
 *
 * The PR-state glyphs (`PrStateIcon` and the three git marks it switches over)
 * and the checks dot live in `@kolu/solid-dockrow` instead: they are what the
 * dock row's PR pip draws, nothing else in the repo drew them, and the row
 * ships as a package so a fleet mirror gets the badge rather than redrawing it.
 */

import type { AgentMark } from "kolu-agents/vocab";
import { type Component, For, Show } from "solid-js";

export const ChevronDownIcon: Component<{ class?: string }> = (props) => (
  <svg
    class={props.class ?? "w-3.5 h-3.5"}
    viewBox="0 0 16 16"
    fill="none"
    stroke="currentColor"
    stroke-width="2"
    stroke-linecap="round"
    aria-hidden="true"
  >
    <path d="M4 6L8 10L12 6" />
  </svg>
);

export const ChevronRightIcon: Component<{ class?: string }> = (props) => (
  <svg
    class={props.class ?? "w-3.5 h-3.5"}
    viewBox="0 0 16 16"
    fill="none"
    stroke="currentColor"
    stroke-width="2"
    stroke-linecap="round"
    aria-hidden="true"
  >
    <path d="M6 4L10 8L6 12" />
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
    aria-hidden="true"
  >
    <path d="M12 10L8 6L4 10" />
  </svg>
);

/** Home glyph — the LOCAL host's tab identity (replaces the word "local"). */
export const HomeIcon: Component<{ class?: string }> = (props) => (
  <svg
    class={props.class ?? "w-3.5 h-3.5"}
    viewBox="0 0 16 16"
    fill="none"
    stroke="currentColor"
    stroke-width="1.5"
    stroke-linecap="round"
    stroke-linejoin="round"
    aria-hidden="true"
  >
    <path d="M2.5 7L8 2.5L13.5 7" />
    <path d="M4 6.5V13h8V6.5" />
  </svg>
);

/** Render an agent's brand mark (from the registry) as one SVG. The mark is
 *  DATA (`AgentMark`: viewBox + paint + paths), so ONE component serves every
 *  agent — the hand-drawn per-agent chrome icons are deleted, and an agent's
 *  mark is declared once in its own package (also the dock pip's mark). */
export const MarkIcon: Component<{ mark: AgentMark; class?: string }> = (
  props,
) => (
  <svg
    class={props.class ?? "w-3 h-3"}
    viewBox={props.mark.viewBox}
    fill={props.mark.paint === "fill" ? "currentColor" : "none"}
    stroke={props.mark.paint === "stroke" ? "currentColor" : undefined}
    stroke-width={
      props.mark.paint === "stroke" ? props.mark.strokeWidth : undefined
    }
    aria-hidden="true"
  >
    <For each={props.mark.paths}>{(d) => <path d={d} />}</For>
  </svg>
);

/** Local diff: pencil icon — uncommitted working-tree edits. */
export const DiffLocalIcon: Component<{ class?: string }> = (props) => (
  <svg
    class={props.class ?? "w-3.5 h-3.5"}
    viewBox="0 0 16 16"
    fill="none"
    stroke="currentColor"
    stroke-width="1.5"
    stroke-linecap="round"
    stroke-linejoin="round"
    aria-hidden="true"
  >
    <path d="M11.5 1.5l3 3-9 9H2.5v-3l9-9z" />
    <path d="M9.5 3.5l3 3" />
  </svg>
);

/** Branch diff: fork icon — what this branch adds vs the base. */
export const DiffBranchIcon: Component<{ class?: string }> = (props) => (
  <svg
    class={props.class ?? "w-3.5 h-3.5"}
    viewBox="0 0 16 16"
    fill="currentColor"
    aria-hidden="true"
  >
    <path d="M5 3.25a.75.75 0 1 1-1.5 0 .75.75 0 0 1 1.5 0zm6.5 0a.75.75 0 1 1-1.5 0 .75.75 0 0 1 1.5 0zM5 12.75a.75.75 0 1 1-1.5 0 .75.75 0 0 1 1.5 0zm-1.25-7.5v5.256a2.25 2.25 0 1 0 1.5 0V7.121A5.69 5.69 0 0 0 9.5 9.5a3.5 3.5 0 0 0 3.5-3.5V5.372a2.25 2.25 0 1 0-1.5 0V6a2 2 0 0 1-2 2 4.19 4.19 0 0 1-3.75-2.846V5.25zM4.25 12a.75.75 0 1 0 0 1.5.75.75 0 0 0 0-1.5z" />
  </svg>
);

export const CopyIcon: Component<{ class?: string }> = (props) => (
  <svg
    class={props.class ?? "w-3.5 h-3.5"}
    viewBox="0 0 16 16"
    fill="none"
    stroke="currentColor"
    stroke-width="1.5"
    stroke-linecap="round"
    stroke-linejoin="round"
    aria-hidden="true"
  >
    <rect x="5" y="5" width="9" height="9" rx="1.5" />
    <path d="M3 11V3a1 1 0 0 1 1-1h8" />
  </svg>
);

export const OpenIcon: Component<{ class?: string }> = (props) => (
  <svg
    class={props.class ?? "w-3.5 h-3.5"}
    viewBox="0 0 16 16"
    fill="none"
    stroke="currentColor"
    stroke-width="1.5"
    stroke-linecap="round"
    stroke-linejoin="round"
    aria-hidden="true"
  >
    <path d="M9 2h5v5" />
    <path d="M14 2L7 9" />
    <path d="M13 9v4a1 1 0 0 1-1 1H3a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1h4" />
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
    aria-hidden="true"
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
    aria-hidden="true"
  >
    <path
      stroke-linecap="round"
      stroke-linejoin="round"
      stroke-width="2"
      d="M4 5a1 1 0 011-1h4a1 1 0 011 1v4a1 1 0 01-1 1H5a1 1 0 01-1-1V5zM14 5a1 1 0 011-1h4a1 1 0 011 1v4a1 1 0 01-1 1h-4a1 1 0 01-1-1V5zM4 15a1 1 0 011-1h4a1 1 0 011 1v4a1 1 0 01-1 1H5a1 1 0 01-1-1v-4zM14 15a1 1 0 011-1h4a1 1 0 011 1v4a1 1 0 01-1 1h-4a1 1 0 01-1-1v-4z"
    />
  </svg>
);

/** Crescent-moon glyph — represents the "parked" / sleeping state of stale
 *  terminals. Used as the minimap toggle for hiding parked tiles. */
export const MoonIcon: Component<{ class?: string }> = (props) => (
  <svg
    class={props.class ?? "w-4 h-4"}
    fill="none"
    stroke="currentColor"
    viewBox="0 0 24 24"
    aria-hidden="true"
  >
    <path
      stroke-linecap="round"
      stroke-linejoin="round"
      stroke-width="2"
      d="M20 14.5A8 8 0 019.5 4 8 8 0 1020 14.5z"
    />
  </svg>
);

export const MenuIcon: Component<{ class?: string }> = (props) => (
  <svg
    class={props.class ?? "w-5 h-5"}
    fill="none"
    stroke="currentColor"
    viewBox="0 0 24 24"
    aria-hidden="true"
  >
    <path
      stroke-linecap="round"
      stroke-linejoin="round"
      stroke-width="2"
      d="M4 6h16M4 12h16M4 18h16"
    />
  </svg>
);

/** Pause icon — two vertical bars. Used inside the recording pill. */
export const PauseIcon: Component<{ class?: string }> = (props) => (
  <svg
    class={props.class ?? "w-3.5 h-3.5"}
    viewBox="0 0 16 16"
    fill="currentColor"
    aria-hidden="true"
  >
    <rect x="4" y="3" width="3" height="10" rx="0.5" />
    <rect x="9" y="3" width="3" height="10" rx="0.5" />
  </svg>
);

/** Resume/play icon — right-pointing triangle. Mirrors `PauseIcon`. */
export const ResumeIcon: Component<{ class?: string }> = (props) => (
  <svg
    class={props.class ?? "w-3.5 h-3.5"}
    viewBox="0 0 16 16"
    fill="currentColor"
    aria-hidden="true"
  >
    <path d="M5 3l8 5-8 5z" />
  </svg>
);

/** Warning triangle — small exclamation, used to flag degraded provider
 *  state (e.g. `gh` not authenticated) in the terminal metadata strip and
 *  inspector. Inherits `currentColor` so callers can tint it via `text-*`. */
export const WarningIcon: Component<{ class?: string }> = (props) => (
  <svg
    class={props.class ?? "w-3.5 h-3.5"}
    viewBox="0 0 16 16"
    fill="none"
    stroke="currentColor"
    stroke-width="1.5"
    stroke-linecap="round"
    stroke-linejoin="round"
    aria-hidden="true"
  >
    <path d="M8 2.5L14 13H2L8 2.5Z" />
    <path d="M8 6.5V9.5" />
    <circle cx="8" cy="11.5" r="0.5" fill="currentColor" />
  </svg>
);

/** Webcam icon — rounded rectangle with a lens. Toggles the PiP overlay. */
export const WebcamIcon: Component<{ class?: string }> = (props) => (
  <svg
    class={props.class ?? "w-3.5 h-3.5"}
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    stroke-width="1.75"
    stroke-linecap="round"
    stroke-linejoin="round"
    aria-hidden="true"
  >
    <rect x="2.5" y="5" width="19" height="13" rx="3" />
    <circle cx="12" cy="11.5" r="3" />
  </svg>
);

/** Video camera — workspace record button. Paired with `ScreenshotIcon`
 *  (still camera = snapshot, camcorder = recording). */
export const RecordIcon: Component<{ class?: string }> = (props) => (
  <svg
    class={props.class ?? "w-3.5 h-3.5"}
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    stroke-width="1.75"
    stroke-linecap="round"
    stroke-linejoin="round"
    aria-hidden="true"
  >
    <rect x="2.5" y="7" width="13" height="10" rx="2" />
    <path d="M15.5 11l5-3v8l-5-3z" />
  </svg>
);

/** Rectangle with a horizontal divider — tile split-toggle button. */
export const SplitToggleIcon: Component<{ class?: string }> = (props) => (
  <svg
    class={props.class ?? "w-3.5 h-3.5"}
    fill="none"
    stroke="currentColor"
    viewBox="0 0 24 24"
    stroke-width="2"
    aria-hidden="true"
  >
    <rect x="3" y="3" width="18" height="18" rx="2" />
    <line x1="3" y1="13" x2="21" y2="13" />
  </svg>
);

/** Camera icon — terminal screenshot button. */
export const ScreenshotIcon: Component<{ class?: string }> = (props) => (
  <svg
    class={props.class ?? "w-3.5 h-3.5"}
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    stroke-width="1.75"
    stroke-linecap="round"
    stroke-linejoin="round"
    aria-hidden="true"
  >
    <path d="M3 7h3l2-2h8l2 2h3a1 1 0 0 1 1 1v10a1 1 0 0 1-1 1H3a1 1 0 0 1-1-1V8a1 1 0 0 1 1-1z" />
    <circle cx="12" cy="13" r="4" />
  </svg>
);

export const ScrollDownIcon: Component<{ class?: string }> = (props) => (
  <svg
    class={props.class ?? "w-5 h-5"}
    fill="none"
    stroke="currentColor"
    viewBox="0 0 24 24"
    aria-hidden="true"
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
    aria-hidden="true"
  >
    <path
      stroke-linecap="round"
      stroke-linejoin="round"
      stroke-width="2"
      d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z"
    />
  </svg>
);

export const EyeIcon: Component<{ class?: string }> = (props) => (
  <svg
    class={props.class ?? "w-4 h-4"}
    fill="none"
    stroke="currentColor"
    viewBox="0 0 24 24"
    aria-hidden="true"
  >
    <path
      stroke-linecap="round"
      stroke-linejoin="round"
      stroke-width="2"
      d="M2.036 12.322a1.012 1.012 0 010-.639C3.423 7.51 7.36 4.5 12 4.5c4.638 0 8.573 3.007 9.963 7.178.07.207.07.431 0 .639C20.577 16.49 16.64 19.5 12 19.5c-4.638 0-8.573-3.007-9.963-7.178z"
    />
    <path
      stroke-linecap="round"
      stroke-linejoin="round"
      stroke-width="2"
      d="M15 12a3 3 0 11-6 0 3 3 0 016 0z"
    />
  </svg>
);

export const SettingsIcon: Component<{ class?: string }> = (props) => (
  <svg
    class={props.class ?? "w-4 h-4"}
    fill="none"
    stroke="currentColor"
    viewBox="0 0 24 24"
    aria-hidden="true"
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

/** Terminal prompt icon — empty-state placeholder for "no terminal selected". */
export const TerminalIcon: Component<{ class?: string }> = (props) => (
  <svg
    class={props.class ?? "w-3.5 h-3.5"}
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    stroke-width="1.5"
    stroke-linecap="round"
    stroke-linejoin="round"
    aria-hidden="true"
  >
    <polyline points="4 17 10 11 4 5" />
    <line x1="12" y1="19" x2="20" y2="19" />
  </svg>
);

export const FileBrowseIcon: Component<{ class?: string }> = (props) => (
  <svg
    class={props.class ?? "w-3.5 h-3.5"}
    viewBox="0 0 16 16"
    fill="currentColor"
    aria-hidden="true"
  >
    <path d="M1.75 1A1.75 1.75 0 0 0 0 2.75v10.5C0 14.216.784 15 1.75 15h12.5A1.75 1.75 0 0 0 16 13.25v-8.5A1.75 1.75 0 0 0 14.25 3H7.5a.25.25 0 0 1-.2-.1l-.9-1.2C6.07 1.26 5.55 1 5 1H1.75z" />
  </svg>
);

/** File with diff line — empty-state placeholder for "select a file". */
export const FileDiffIcon: Component<{ class?: string }> = (props) => (
  <svg
    class={props.class ?? "w-3.5 h-3.5"}
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    stroke-width="1.5"
    stroke-linecap="round"
    stroke-linejoin="round"
    aria-hidden="true"
  >
    <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
    <polyline points="14 2 14 8 20 8" />
    <line x1="9" y1="15" x2="15" y2="15" />
  </svg>
);

/** Git branch icon (filled) — empty-state placeholder for "not a git repo". */
export const GitBranchIcon: Component<{ class?: string }> = (props) => (
  <svg
    class={props.class ?? "w-3.5 h-3.5"}
    viewBox="0 0 16 16"
    fill="currentColor"
    aria-hidden="true"
  >
    <path d="M5 3.25a.75.75 0 1 1-1.5 0 .75.75 0 0 1 1.5 0zm6.5 0a.75.75 0 1 1-1.5 0 .75.75 0 0 1 1.5 0zM5 12.75a.75.75 0 1 1-1.5 0 .75.75 0 0 1 1.5 0zm-1.25-7.5v5.256a2.25 2.25 0 1 0 1.5 0V7.121A5.69 5.69 0 0 0 9.5 9.5a3.5 3.5 0 0 0 3.5-3.5V5.372a2.25 2.25 0 1 0-1.5 0V6a2 2 0 0 1-2 2 4.19 4.19 0 0 1-3.75-2.846V5.25zM4.25 12a.75.75 0 1 0 0 1.5.75.75 0 0 0 0-1.5z" />
  </svg>
);

/** Maximize — outline square for "fill the canvas with the active tile". */
export const MaximizeIcon: Component<{ class?: string }> = (props) => (
  <svg
    class={props.class ?? "w-3.5 h-3.5"}
    viewBox="0 0 16 16"
    fill="none"
    stroke="currentColor"
    stroke-width="1.5"
    stroke-linecap="round"
    stroke-linejoin="round"
    aria-hidden="true"
  >
    <rect x="2.5" y="2.5" width="11" height="11" rx="1" />
  </svg>
);

/** Restore — nested squares for "return to the tiled canvas view". */
export const RestoreIcon: Component<{ class?: string }> = (props) => (
  <svg
    class={props.class ?? "w-3.5 h-3.5"}
    viewBox="0 0 16 16"
    fill="none"
    stroke="currentColor"
    stroke-width="1.5"
    stroke-linecap="round"
    stroke-linejoin="round"
    aria-hidden="true"
  >
    <rect x="5" y="2.5" width="8.5" height="8.5" rx="1" />
    <rect x="2.5" y="5" width="8.5" height="8.5" rx="1" />
  </svg>
);

/** Restart — a circular arrow for "recycle the kaval daemon". */
export const RestartIcon: Component<{ class?: string }> = (props) => (
  <svg
    class={props.class ?? "w-3.5 h-3.5"}
    viewBox="0 0 16 16"
    fill="none"
    stroke="currentColor"
    stroke-width="1.5"
    stroke-linecap="round"
    stroke-linejoin="round"
    aria-hidden="true"
  >
    <path d="M13.5 8a5.5 5.5 0 1 1-1.6-3.9" />
    <path d="M13.5 2.5v3h-3" />
  </svg>
);

/** Inspector toggle — square with a divider on the right edge.
 *  Filled-right when active to indicate the right panel is open. */
export const InspectorToggleIcon: Component<{ active?: boolean }> = (props) => (
  <svg
    class="w-3.5 h-3.5"
    fill="none"
    stroke="currentColor"
    viewBox="0 0 24 24"
    stroke-width="2"
    aria-hidden="true"
  >
    <rect x="3" y="3" width="18" height="18" rx="2" />
    <line x1="15" y1="3" x2="15" y2="21" />
    <Show when={props.active}>
      <rect x="15" y="3" width="6" height="18" rx="0" />
    </Show>
  </svg>
);

/** Dock (dock) toggle — mirror of InspectorToggleIcon for the
 *  left-edge panel. Filled-left when active = dock is expanded (cards
 *  or mega); empty-left = dock is in rail (collapsed) mode. */
export const DockToggleIcon: Component<{ active?: boolean }> = (props) => (
  <svg
    class="w-3.5 h-3.5"
    fill="none"
    stroke="currentColor"
    viewBox="0 0 24 24"
    stroke-width="2"
    aria-hidden="true"
  >
    <rect x="3" y="3" width="18" height="18" rx="2" />
    <line x1="9" y1="3" x2="9" y2="21" />
    <Show when={props.active}>
      <rect x="3" y="3" width="6" height="18" rx="0" />
    </Show>
  </svg>
);

export const WorktreeIcon: Component<{ class?: string }> = (props) => (
  <svg
    class={props.class ?? "w-3 h-3"}
    fill="none"
    stroke="currentColor"
    viewBox="0 0 24 24"
    aria-hidden="true"
  >
    <circle cx="12" cy="4" r="2" stroke-width="1.5" />
    <circle cx="6" cy="20" r="2" stroke-width="1.5" />
    <circle cx="18" cy="20" r="2" stroke-width="1.5" />
    <path
      stroke-linecap="round"
      stroke-width="1.5"
      d="M12 6v4c0 2-2 4-6 8M12 10c0 2 2 4 6 8"
    />
  </svg>
);

export const PlusIcon: Component<{ class?: string }> = (props) => (
  <svg
    class={props.class ?? "w-3.5 h-3.5"}
    fill="none"
    stroke="currentColor"
    viewBox="0 0 24 24"
    stroke-width="2"
    aria-hidden="true"
  >
    <path stroke-linecap="round" d="M12 5v14M5 12h14" />
  </svg>
);
