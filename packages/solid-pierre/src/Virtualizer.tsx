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
