/** SolidJS provider for `@pierre/diffs`' `Virtualizer`. Wrap a scrollable
 *  region in `<Virtualizer>` and any descendant `<FileDiff>` / `<FileView>`
 *  upgrades from the vanilla class to its virtualized counterpart, picking
 *  up Pierre's intersection-observer + windowed-render machinery for free.
 *
 *  Pierre's `Virtualizer` is panel-scoped: one instance per scroll
 *  container, shared across every file inside. The outer `<div>` rendered
 *  here IS that scroll container — `setup(root)` registers it with
 *  Pierre. Children are placed inside a content `<div>`, matching the
 *  shape of `@pierre/diffs/dist/react/Virtualizer.js`.
 *
 *  Lifecycle:
 *  - The instance is constructed eagerly at component setup (skipped on
 *    SSR — `setup` requires `ResizeObserver` / `IntersectionObserver`).
 *  - `onMount` calls `setup(root)`. Children call `connect()` from their
 *    own `onMount` — Solid runs children's `onMount` before the parent's,
 *    so those `connect()` calls land before `setup()`. Pierre handles
 *    that ordering via an internal `connectQueue`: pre-setup connects are
 *    queued and replayed when `setup` runs. */

import {
  Virtualizer as VirtualizerClass,
  type VirtualizerConfig,
} from "@pierre/diffs";
import {
  type Component,
  createContext,
  type JSX,
  type ParentProps,
  onCleanup,
  onMount,
  useContext,
} from "solid-js";

const VirtualizerContext = createContext<VirtualizerClass | undefined>(
  undefined,
);

/** Returns the Pierre `Virtualizer` instance for the nearest enclosing
 *  `<Virtualizer>`, or `undefined` if there isn't one. `<FileDiff>` and
 *  `<FileView>` use this internally to switch on virtualization; host
 *  code rarely needs to call it directly. */
export const useVirtualizer = (): VirtualizerClass | undefined =>
  useContext(VirtualizerContext);

export type VirtualizerProps = ParentProps<{
  /** Pierre `VirtualizerConfig` overrides — captured once at construction
   *  time. Reactive changes are not propagated (matches Pierre's React
   *  wrapper). */
  config?: Partial<VirtualizerConfig>;
  /** Forwarded to the outer scroll-container `<div>`. Apply
   *  `overflow-auto` / `overflow-y-auto` here — this element IS the
   *  scroll surface Pierre observes. */
  class?: string;
  style?: JSX.CSSProperties;
  /** Forwarded to the inner content `<div>`. */
  contentClass?: string;
  contentStyle?: JSX.CSSProperties;
}>;

/** Cheap dev-mode flag. Vite sets `import.meta.env.DEV`; non-Vite
 *  consumers (Vitest, future bundlers) may not — gracefully fall back
 *  to `false` so the warning never fires in production builds. */
const isDevMode = (): boolean => {
  try {
    // biome-ignore lint/suspicious/noExplicitAny: bundler-provided env shape
    return Boolean((import.meta as any)?.env?.DEV);
  } catch {
    return false;
  }
};

export const Virtualizer: Component<VirtualizerProps> = (props) => {
  let root!: HTMLDivElement;

  // Skip on SSR — Pierre's `Virtualizer` ctor is fine without DOM, but
  // `setup` synchronously instantiates `ResizeObserver` /
  // `IntersectionObserver`, which are window-only.
  const instance =
    typeof window !== "undefined"
      ? new VirtualizerClass(props.config)
      : undefined;

  onMount(() => {
    instance?.setup(root);
    // Pierre's intersection-observer is rooted at this element. If the
    // root has `overflow: visible`, the observer computes intersection
    // against the layout box (which grows with content), so every file
    // inside is "visible" and Pierre falls back to full-DOM rendering —
    // virtualization silently degrades. Catch the misconfig at the
    // boundary instead of letting consumers debug "why is the lockfile
    // diff still slow".
    if (isDevMode()) {
      queueMicrotask(() => {
        const overflowY = getComputedStyle(root).overflowY;
        if (overflowY === "visible") {
          console.warn(
            "[@kolu/solid-pierre] <Virtualizer> root has `overflow-y: visible`; virtualization will silently degrade to full-DOM rendering. Apply `overflow-y-auto` (or `overflow-auto`) to the <Virtualizer>'s class.",
          );
        }
      });
    }
  });
  onCleanup(() => {
    instance?.cleanUp();
  });

  return (
    <VirtualizerContext.Provider value={instance}>
      <div
        ref={root}
        class={props.class}
        style={props.style}
        data-testid="pierre-virtualizer"
      >
        <div class={props.contentClass} style={props.contentStyle}>
          {props.children}
        </div>
      </div>
    </VirtualizerContext.Provider>
  );
};

export default Virtualizer;
