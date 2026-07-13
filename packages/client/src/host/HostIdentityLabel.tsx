/** A host's on-screen identity: a house glyph (LOCAL only) immediately before
 *  its role word, glyph first — so the local chip reads as a role ("the machine
 *  kolu runs on"), not a hostname you might mistake for a machine literally
 *  named "local" (a remote's `user@host` is unambiguous already, so it gets no
 *  glyph). The single owner of the glyph+label pairing, so every visual site
 *  renders it identically and a new render site can't silently split or drop it.
 *  `labelClass` styles the label `<span>` (truncation/max-width vary per site);
 *  `glyphClass` sizes the house glyph (default `h-3 w-3`; the mobile chip runs a
 *  hair larger) — a per-site pixel, not a reason to fork the pairing. */

import { type Component, Show } from "solid-js";
import type { HostKey } from "kolu-common/hostKey";
import { HomeIcon } from "../ui/Icons";
import { hostLabel } from "./hostChipTone";

export const HostIdentityLabel: Component<{
  host: HostKey;
  labelClass?: string;
  glyphClass?: string;
}> = (props) => (
  <>
    <Show when={props.host.kind === "local"}>
      <HomeIcon
        class={`${props.glyphClass ?? "h-3 w-3"} shrink-0 opacity-70`}
      />
    </Show>
    <span class={props.labelClass}>{hostLabel(props.host)}</span>
  </>
);
