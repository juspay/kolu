/** Kolu's notes surface consumes the shared `@kolu/solid-markdown`
 *  renderer. These thin wrappers pin the package's `variant` + link policy
 *  for the two notes use-sites, so the ~8 call sites (title bar, dock
 *  rows, switcher cards, sub-panel tabs, notes body + editor) stay
 *  unchanged. The renderer itself — `marked` + sanitization + the token
 *  walk — now lives in the package. */

import { Markdown } from "@kolu/solid-markdown";
import type { Component } from "solid-js";

/** Safe markdown renderer for full notes text in workspace surfaces.
 *  Block layout at chat/dock scale. `links` is passed through unset so the
 *  package's own default applies (block variants → links on) — the policy
 *  lives in one place, not shadowed here. */
export const NotesMarkdownBlock: Component<{
  markdown: string;
  links?: boolean;
}> = (props) => (
  <Markdown markdown={props.markdown} variant="compact" links={props.links} />
);

/** Inline-only markdown for the annotation slot — line 1 of notes renders
 *  in the title bar, dock rows, switcher cards, and sub-panel tabs (plain
 *  text for non-markdown input like branch names). Links default off so the
 *  slot's click handler (open the Notes tab / open palette) isn't preempted
 *  by a nested anchor — which is the package's default for the inline
 *  variant, so `links` is passed through unset rather than re-defaulted
 *  here. */
export const NotesMarkdownInline: Component<{
  markdown: string;
  links?: boolean;
}> = (props) => (
  <Markdown markdown={props.markdown} variant="inline" links={props.links} />
);
