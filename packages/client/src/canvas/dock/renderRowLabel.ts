import type { JSX } from "solid-js";
import { IntentMarkdownInline } from "../../intent/IntentMarkdown";

export const renderRowLabel = (markdown: string): JSX.Element =>
  IntentMarkdownInline({ markdown });
