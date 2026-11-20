import type { Component, JSX } from "solid-js";

export const DOC_SLUGS = [
  "agent-detection",
  "agents",
  "agent-fleets",
  "architecture",
  "canvas",
  "clipboard",
  "code-tab",
  "conductor-setup",
  "concepts",
  "deployment",
  "dock",
  "first-five-minutes",
  "from-a-mac",
  "install-pwa",
  "kaval",
  "keyboard-shortcuts",
  "mcp",
  "mobile",
  "notifications",
  "operations",
  "conductor",
  "padi",
  "philosophy",
  "power-features",
  "quickstart",
  "read-a-plan",
  "remote-access",
  "remote-hosts",
  "right-panel",
  "sessions",
  "shell-integration",
  "start",
  "switcher",
  "terminal-ui",
  "theming",
  "tiles",
  "troubleshooting",
  "work-card",
] as const;

export type DocSlug = (typeof DOC_SLUGS)[number];

/** Absolute URL for a product-docs page; optional `#anchor` is appended. */
export function docUrl(slug: DocSlug, anchor?: string): string {
  const base = `https://kolu.dev/${slug}/`;
  return anchor ? `${base}#${anchor}` : base;
}

export const DocLink: Component<{
  slug: DocSlug;
  anchor?: string;
  children: JSX.Element;
  class?: string;
  "data-testid"?: string;
}> = (props) => (
  <a
    href={docUrl(props.slug, props.anchor)}
    target="_blank"
    rel="noopener noreferrer"
    class={props.class ?? "text-accent hover:underline"}
    data-testid={props["data-testid"]}
  >
    {props.children}
  </a>
);

export default DocLink;
