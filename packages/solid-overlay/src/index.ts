/** `@kolu/solid-overlay` — anchored-positioning primitives for floating UI.
 *  `useAnchoredPopover` owns the open/dismiss + viewport-flip placement logic
 *  (portal-safe, always pointer-event-interactive); `OptionMenu` is the
 *  ready-made anchored option list built on it. */

export type {
  AnchorSide,
  UseAnchoredPopover,
  UseAnchoredPopoverOpts,
} from "./useAnchoredPopover";
export { useAnchoredPopover } from "./useAnchoredPopover";
export type { OptionMenuItem } from "./OptionMenu";
export { OptionMenu } from "./OptionMenu";
