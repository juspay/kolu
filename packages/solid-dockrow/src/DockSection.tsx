import { type Component, type JSX, Show } from "solid-js";
import {
  DOCK_NEEDS_YOU_STRIP_CLASS,
  DOCK_ROW_SURFACE,
  DOCK_ROW_GAP,
  DOCK_ROW_GRID,
  DOCK_SECTION_CLASS,
  type DockRowSurface,
  type NeedsYouDensity,
} from "./geometry.ts";

/** One repo's card — the grid the rows subgrid into, the wash scope, and the
 *  `--repo-color` socket every repo-tinted surface inside it reads. */
export const DockSection: Component<{
  surface: DockRowSurface;
  /** The repo hue every tinted surface in the card reads (`--repo-color`). */
  repoColor: string;
  header?: JSX.Element;
  headerTestId?: string;
  /** The repo this card is for — `data-repo`, an e2e/debug handle. */
  repo?: string;
  testId?: string;
  ref?: HTMLElement | ((el: HTMLElement) => void);
  styleProp?: JSX.CSSProperties;
  children: JSX.Element;
}> = (props) => (
  <section
    data-testid={props.testId}
    data-repo={props.repo}
    ref={props.ref}
    style={{ ...props.styleProp, "--repo-color": props.repoColor }}
    class={`${DOCK_SECTION_CLASS} grid ${DOCK_ROW_GRID} ${DOCK_ROW_GAP} ${DOCK_ROW_SURFACE[props.surface].sectionPad}`}
  >
    <Show when={props.header}>
      <div
        data-testid={props.headerTestId}
        class={`dock-cards-section-header col-span-full ${DOCK_ROW_SURFACE[props.surface].headerPad}`}
      >
        {props.header}
      </div>
    </Show>
    {props.children}
  </section>
);

/** Event-listener dict a consumer's drag library (solid-dnd's `dragActivators`,
 *  slots any pointer-sensor) spreads onto an element: keys are the sensor's
 *  event names (`onpointerdown`, …). The package invents no library of its
 *  own, so the socket is as narrow as "a dict of functions". */
export type DockDragHandlers = Record<string, (event: Event) => void>;

export const DockCluster: Component<{
  /** The cluster's branch/intent label — `data-label`, an e2e/debug handle. */
  label: string;
  /** Consumer's sortable ref — the package ships no drag lib of its own. */
  ref?: HTMLDivElement | ((el: HTMLDivElement) => void);
  /** Consumer's sortable transform — during a drag, the wrapper moves; rows never do. */
  style?: JSX.CSSProperties;
  /** Consumer's activator listeners, spread onto the element (e.g. pointerdown). */
  handlers?: DockDragHandlers;
  children: JSX.Element;
}> = (props) => (
  <div
    ref={props.ref}
    style={props.style}
    {...props.handlers}
    data-label={props.label}
    class="dock-cluster grid grid-cols-subgrid col-span-full"
  >
    {props.children}
  </div>
);

export const DockNeedsYouStrip: Component<{
  density: NeedsYouDensity;
  testId?: string;
  children: JSX.Element;
}> = (props) => (
  <section
    data-testid={props.testId}
    aria-label="Agents waiting on you"
    class={`${DOCK_NEEDS_YOU_STRIP_CLASS} shrink-0 flex flex-col gap-0.5 border-b border-edge/40 py-1`}
    classList={{ "px-1": props.density === "full" }}
  >
    <Show when={props.density === "full"}>
      <span class="px-1.5 font-mono text-[0.55rem] font-bold uppercase tracking-[0.12em] text-fg-3">
        Needs you
      </span>
    </Show>
    {props.children}
  </section>
);
