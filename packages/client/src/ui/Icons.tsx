/**
 * Shared SVG icon components — centralized so markup stays in sync.
 * Each icon takes an optional `class` prop (defaults to a sensible size).
 * Keep alphabetically sorted when adding new icons.
 */

import type { Component } from "solid-js";
import { Dynamic } from "solid-js/web";

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

export const ChevronRightIcon: Component<{ class?: string }> = (props) => (
  <svg
    class={props.class ?? "w-3.5 h-3.5"}
    viewBox="0 0 16 16"
    fill="none"
    stroke="currentColor"
    stroke-width="2"
    stroke-linecap="round"
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
  >
    <path d="M12 10L8 6L4 10" />
  </svg>
);

/** Official Claude AI logo — from claude.ai/favicon.svg. */
export const ClaudeCodeIcon: Component<{ class?: string }> = (props) => (
  <svg
    class={props.class ?? "w-3 h-3"}
    viewBox="0 0 248 248"
    fill="currentColor"
  >
    <path d="M52.4285 162.873L98.7844 136.879L99.5485 134.602L98.7844 133.334H96.4921L88.7237 132.862L62.2346 132.153L39.3113 131.207L17.0249 130.026L11.4214 128.844L6.2 121.873L6.7094 118.447L11.4214 115.257L18.171 115.847L33.0711 116.911L55.485 118.447L71.6586 119.392L95.728 121.873H99.5485L100.058 120.337L98.7844 119.392L97.7656 118.447L74.5877 102.732L49.4995 86.1905L36.3823 76.62L29.3779 71.7757L25.8121 67.2858L24.2839 57.3608L30.6515 50.2716L39.3113 50.8623L41.4763 51.4531L50.2636 58.1879L68.9842 72.7209L93.4357 90.6804L97.0015 93.6343L98.4374 92.6652L98.6571 91.9801L97.0015 89.2625L83.757 65.2772L69.621 40.8192L63.2534 30.6579L61.5978 24.632C60.9565 22.1032 60.579 20.0111 60.579 17.4246L67.8381 7.49965L71.9133 6.19995L81.7193 7.49965L85.7946 11.0443L91.9074 24.9865L101.714 46.8451L116.996 76.62L121.453 85.4816L123.873 93.6343L124.764 96.1155H126.292V94.6976L127.566 77.9197L129.858 57.3608L132.15 30.8942L132.915 23.4505L136.608 14.4708L143.994 9.62643L149.725 12.344L154.437 19.0788L153.8 23.4505L150.998 41.6463L145.522 70.1215L141.957 89.2625H143.994L146.414 86.7813L156.093 74.0206L172.266 53.698L179.398 45.6635L187.803 36.802L193.152 32.5484H203.34L210.726 43.6549L207.415 55.1159L196.972 68.3492L188.312 79.5739L175.896 96.2095L168.191 109.585L168.882 110.689L170.738 110.53L198.755 104.504L213.91 101.787L231.994 98.7149L240.144 102.496L241.036 106.395L237.852 114.311L218.495 119.037L195.826 123.645L162.07 131.592L161.696 131.893L162.137 132.547L177.36 133.925L183.855 134.279H199.774L229.447 136.524L237.215 141.605L241.8 147.867L241.036 152.711L229.065 158.737L213.019 154.956L175.45 145.977L162.587 142.787H160.805V143.85L171.502 154.366L191.242 172.089L215.82 195.011L217.094 200.682L213.91 205.172L210.599 204.699L188.949 188.394L180.544 181.069L161.696 165.118H160.422V166.772L164.752 173.152L187.803 207.771L188.949 218.405L187.294 221.832L181.308 223.959L174.813 222.777L161.187 203.754L147.305 182.486L136.098 163.345L134.745 164.2L128.075 235.42L125.019 239.082L117.887 241.8L111.902 237.31L108.718 229.984L111.902 215.452L115.722 196.547L118.779 181.541L121.58 162.873L123.291 156.636L123.14 156.219L121.773 156.449L107.699 175.752L86.304 204.699L69.3663 222.777L65.291 224.431L58.2867 220.768L58.9235 214.27L62.8713 208.48L86.304 178.705L100.44 160.155L109.551 149.507L109.462 147.967L108.959 147.924L46.6977 188.512L35.6182 189.93L30.7788 185.44L31.4156 178.115L33.7079 175.752L52.4285 162.873Z" />
  </svg>
);

/** OpenCode logo — simplified from their favicon.svg (a hollow rectangle).
 *  ViewBox tightened to the content bounding box (originally 512×512 with
 *  ~30% padding on each side, which made the icon look tiny next to other
 *  agent icons that fill their viewBox). */
export const OpenCodeIcon: Component<{ class?: string }> = (props) => (
  <svg
    class={props.class ?? "w-3 h-3"}
    viewBox="112 80 288 352"
    fill="currentColor"
  >
    <path d="M320 224V352H192V224H320Z" opacity="0.5" />
    <path
      fill-rule="evenodd"
      clip-rule="evenodd"
      d="M384 416H128V96H384V416ZM320 160H192V352H320V160Z"
    />
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
  >
    <path d="M5 3.25a.75.75 0 1 1-1.5 0 .75.75 0 0 1 1.5 0zm6.5 0a.75.75 0 1 1-1.5 0 .75.75 0 0 1 1.5 0zM5 12.75a.75.75 0 1 1-1.5 0 .75.75 0 0 1 1.5 0zm-1.25-7.5v5.256a2.25 2.25 0 1 0 1.5 0V7.121A5.69 5.69 0 0 0 9.5 9.5a3.5 3.5 0 0 0 3.5-3.5V5.372a2.25 2.25 0 1 0-1.5 0V6a2 2 0 0 1-2 2 4.19 4.19 0 0 1-3.75-2.846V5.25zM4.25 12a.75.75 0 1 0 0 1.5.75.75 0 0 0 0-1.5z" />
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

const prStateConfig: Record<
  "open" | "closed" | "merged",
  { icon: Component<{ class?: string }>; color: string }
> = {
  open: { icon: GitPullRequestIcon, color: "text-ok" },
  closed: { icon: GitPullRequestClosedIcon, color: "text-danger" },
  merged: { icon: GitMergeIcon, color: "text-purple-400" },
};

/** PR state icon — green for open, purple for merged, red for closed. */
export const PrStateIcon: Component<{
  state: "open" | "closed" | "merged";
  class?: string;
}> = (props) => {
  const cfg = () => prStateConfig[props.state];
  return (
    <span class={`${cfg().color} shrink-0`}>
      <Dynamic component={cfg().icon} class={props.class ?? "w-3.5 h-3.5"} />
    </span>
  );
};

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
  >
    <polyline points="4 17 10 11 4 5" />
    <line x1="12" y1="19" x2="20" y2="19" />
  </svg>
);

/** File tree browser: folder icon — browse the full repo structure. */
export const FileBrowseIcon: Component<{ class?: string }> = (props) => (
  <svg
    class={props.class ?? "w-3.5 h-3.5"}
    viewBox="0 0 16 16"
    fill="currentColor"
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
  >
    <path d="M5 3.25a.75.75 0 1 1-1.5 0 .75.75 0 0 1 1.5 0zm6.5 0a.75.75 0 1 1-1.5 0 .75.75 0 0 1 1.5 0zM5 12.75a.75.75 0 1 1-1.5 0 .75.75 0 0 1 1.5 0zm-1.25-7.5v5.256a2.25 2.25 0 1 0 1.5 0V7.121A5.69 5.69 0 0 0 9.5 9.5a3.5 3.5 0 0 0 3.5-3.5V5.372a2.25 2.25 0 1 0-1.5 0V6a2 2 0 0 1-2 2 4.19 4.19 0 0 1-3.75-2.846V5.25zM4.25 12a.75.75 0 1 0 0 1.5.75.75 0 0 0 0-1.5z" />
  </svg>
);

export const WorktreeIcon: Component<{ class?: string }> = (props) => (
  <svg
    class={props.class ?? "w-3 h-3"}
    fill="none"
    stroke="currentColor"
    viewBox="0 0 24 24"
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
