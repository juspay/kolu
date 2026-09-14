/** kolu's answer to `@kolu/solid-dockrow`'s `renderLabel` — the one place the
 *  Dock decides what renders a row's annotation line.
 *
 *  The row package takes the renderer as a REQUIRED prop and ships none of its
 *  own: a markdown engine costs a consumer `marked`, `dompurify`, `shiki` and
 *  `yaml` in its manifest closure, and sanitisation and link policy are a
 *  different volatility from row layout. That is the package's decision to
 *  push out, and it is right — but it is not four decisions. All four dock row
 *  surfaces answer it identically, so the answer is spelled here once instead
 *  of as the same three-line closure at every call site, where "identically"
 *  would have been a thing to keep true rather than a thing that is. */

import type { JSX } from "solid-js";
import { IntentMarkdownInline } from "../../intent/IntentMarkdown";

export const renderRowLabel = (markdown: string): JSX.Element =>
  IntentMarkdownInline({ markdown });
