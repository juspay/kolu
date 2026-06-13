/** ScopeSegments — the Code tab's file-scope switcher.
 *
 *  A segmented control over the three mutually-exclusive views
 *  (`browse` / `local` / `branch`), replacing the old chip + popover
 *  dropdown. Every view is visible at once, which is the whole point:
 *  the two git-diff segments carry a live change-count badge, so a
 *  non-empty mode advertises itself *without* the user switching into
 *  it — the one affordance a collapsed dropdown structurally couldn't
 *  offer.
 *
 *  The whole-repo `browse` segment is set apart from the two diff
 *  segments by a divider (it's a file tree, not a diff, and is never
 *  badged). A divider is drawn wherever the segment `group` changes.
 *
 *  Purely presentational — the host owns the segment list (label, hint,
 *  icon, optional count, group); this component owns only the layout,
 *  the active styling, and the badge. */

import type { CodeTabView } from "kolu-common/surface";
import { type Component, Index, Show } from "solid-js";
import { Dynamic } from "solid-js/web";

export type ScopeSegment = {
  view: CodeTabView;
  label: string;
  /** Tooltip (title attr) — the longer description the old popover
   *  showed inline, e.g. "Working tree vs HEAD". */
  hint: string;
  testId: string;
  /** Leading glyph. Host owns the icon registry so the segment control
   *  doesn't import every possible icon. */
  icon: Component<{ class?: string }>;
  /** Changed-file count badge; rendered only when `> 0`. `undefined`
   *  means never badged (the browse segment, and Branch with no base). */
  count?: number;
  /** Segments sharing a `group` sit together; a divider is drawn where
   *  the group changes (browse ┊ git). */
  group: string;
};

const ScopeSegments: Component<{
  view: CodeTabView;
  onViewChange: (v: CodeTabView) => void;
  segments: readonly ScopeSegment[];
}> = (props) => (
  <div
    class="flex items-center gap-0.5 shrink-0 rounded bg-surface-2/40 p-0.5"
    role="toolbar"
    aria-label="File scope"
    data-testid="code-scope-segments"
    data-mode={props.view}
  >
    <Index each={props.segments}>
      {(seg, idx) => (
        <>
          <Show
            when={idx > 0 && seg().group !== props.segments[idx - 1]?.group}
          >
            <div
              class="self-stretch w-px bg-edge/60 mx-0.5"
              aria-hidden="true"
            />
          </Show>
          <button
            type="button"
            aria-pressed={props.view === seg().view}
            onClick={() => props.onViewChange(seg().view)}
            class="flex items-center gap-1.5 px-2 h-5 rounded text-[10px] font-mono cursor-pointer transition-colors text-fg-2 hover:text-fg hover:bg-surface-2/60 data-[active=true]:bg-surface-0 data-[active=true]:text-fg data-[active=true]:shadow-sm"
            data-testid={seg().testId}
            data-active={props.view === seg().view}
            data-mode={seg().view}
            title={seg().hint}
          >
            <Dynamic component={seg().icon} class="w-3 h-3 opacity-70" />
            <span>{seg().label}</span>
            <Show when={(seg().count ?? 0) > 0}>
              <span
                class="inline-flex items-center justify-center h-3.5 min-w-3.5 px-1 rounded-full bg-accent/20 text-fg text-[0.6rem] font-semibold tabular-nums"
                data-testid={`${seg().testId}-count`}
              >
                {seg().count}
              </span>
            </Show>
          </button>
        </>
      )}
    </Index>
  </div>
);

export default ScopeSegments;
