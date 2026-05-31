/** Kolu's intent surface consumes the shared `@kolu/solid-markdown`
 *  renderer. These thin wrappers pin the package's `variant` + link policy
 *  for the two intent use-sites, so the ~8 call sites (title bar, dock
 *  rows, switcher cards, sub-panel tabs, intent body + editor) stay
 *  unchanged. The renderer itself — `marked` + sanitization + the token
 *  walk — now lives in the package. */

import { Markdown } from "@kolu/solid-markdown";
import type { Component } from "solid-js";

/** Safe markdown renderer for full intent text in workspace surfaces.
 *  Block layout at chat/dock scale; links on by default. */
export const IntentMarkdownBlock: Component<{
  markdown: string;
  links?: boolean;
}> = (props) => (
  <Markdown
    markdown={props.markdown}
    variant="compact"
    links={props.links ?? true}
  />
);

/** Inline-only markdown for the annotation slot — line 1 of intent renders
 *  in the title bar, dock rows, switcher cards, and sub-panel tabs (plain
 *  text for non-markdown input like branch names). Links default off so the
 *  slot's click handler (open editor / open palette) isn't preempted by a
 *  nested anchor. */
export const IntentMarkdownInline: Component<{
  markdown: string;
  links?: boolean;
}> = (props) => (
  <Markdown
    markdown={props.markdown}
    variant="inline"
    links={props.links ?? false}
  />
);
