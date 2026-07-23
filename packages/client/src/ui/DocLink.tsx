/** One leaf module for every in-app kolu.dev doc URL.
 *
 *  The website content directory (`website/src/content/docs/*.mdx`) is the source
 *  of truth for which pages exist. `DOC_SLUGS` is the hand-kept mirror that both
 *  the `DocSlug` type and the set-equality test in `DocLink.test.ts` share — a
 *  rename or delete on either side is a red build. The grep law in that same
 *  test bans a hand-rolled `kolu.dev` literal anywhere else under
 *  `packages/client/src`, so this is the only place a doc URL is spelled. */

import type { Component, JSX } from "solid-js";

/** Every product-docs page under `website/src/content/docs/`. Keep in lock-step
 *  with the basenames there — the set-equality test enforces both directions. */
export const DOC_SLUGS = [
  "agent-detection",
  "agent-fleets",
  "architecture",
  "canvas",
  "clipboard",
  "code-tab",
  "concepts",
  "dock",
  "first-five-minutes",
  "install-pwa",
  "kaval",
  "keyboard-shortcuts",
  "mcp",
  "mobile",
  "notifications",
  "padi",
  "philosophy",
  "power-features",
  "quickstart",
  "remote-access",
  "remote-hosts",
  "right-panel",
  "sessions",
  "terminal-ui",
  "theming",
  "tiles",
  "troubleshooting",
] as const;

export type DocSlug = (typeof DOC_SLUGS)[number];

/** Absolute URL for a product-docs page. Trailing slash matches the existing
 *  kaval / website spelling. Optional `#anchor` is appended when provided. */
export function docUrl(slug: DocSlug, anchor?: string): string {
  const base = `https://kolu.dev/${slug}/`;
  return anchor ? `${base}#${anchor}` : base;
}

/** Inline "learn more" anchor — accent text, opens in a new tab. Button-chrome
 *  sites (the KavalInfoDialog "Docs" button) keep their own styling and take
 *  `docUrl()` for the href instead. */
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
