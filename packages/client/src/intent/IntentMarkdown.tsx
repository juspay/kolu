import { Markdown } from "@kolu/solid-markdown";
import type { Component } from "solid-js";

export const IntentMarkdownBlock: Component<{
  markdown: string;
  links?: boolean;
}> = (props) => (
  <Markdown markdown={props.markdown} variant="compact" links={props.links} />
);

export const IntentMarkdownInline: Component<{
  markdown: string;
  links?: boolean;
}> = (props) => (
  <Markdown markdown={props.markdown} variant="inline" links={props.links} />
);
