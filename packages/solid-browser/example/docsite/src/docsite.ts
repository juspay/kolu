/** A miniature doc-site — a *second host* that plugs its own location type and
 *  its own content map into `@kolu/solid-browser`'s `createBrowser`, reusing the
 *  exact back/forward history the kolu Code tab uses.
 *
 *  This is the package's electricity proof (③ in the plan note): nothing here is
 *  kolu — no git, no `FileData`, no Solid components, no DOM — yet the history
 *  controller drops in unchanged. kolu's host injects "repo-relative path + git
 *  mode"; this host injects "doc slug + a static content map." Same `Browser`,
 *  different volatility plugged in behind it. Swap kolu's resolver for this map
 *  and the same browser reads a wiki. */

import { type Browser, createBrowser } from "@kolu/solid-browser";

/** This host's notion of a location: a slug into its own doc set. (kolu's is
 *  `{ mode, path, ref }` — the controller is agnostic to either.) */
export type DocLocation = { slug: string };

/** A page in the doc set: what this host renders, and the links it offers. */
export type Doc = { title: string; body: string; links: string[] };

export type DocSite = {
  /** The doc currently in view — resolved from the browser's current location
   *  through *this host's own* content map. */
  currentDoc: () => Doc | null;
  /** The current slug, or null before anything is open. */
  currentSlug: () => string | null;
  /** Follow a link to another doc. Records history — the address-bar path. */
  open: (slug: string) => void;
  /** Go back to the previously-viewed doc. */
  back: () => void;
  /** Go forward again after going back. */
  forward: () => void;
  /** Is there an earlier doc to return to? (Drives a ◀ button.) */
  canBack: () => boolean;
  /** Is there a later doc to advance to? (Drives a ▶ button.) */
  canForward: () => boolean;
};

/** Build a doc-site over a fixed content map. `home` seeds the first page so
 *  the site opens on something. The whole back/forward feature is just the
 *  injected `createBrowser` — this function adds only the host's content
 *  resolution (`slug → Doc`) on top. */
export function createDocSite(
  docs: Record<string, Doc>,
  home: string,
): DocSite {
  const browser: Browser<DocLocation> = createBrowser<DocLocation>({
    initial: { slug: home },
    // Two visits to the same slug are the same page — re-opening the current
    // doc shouldn't deepen history (replaceState, not pushState).
    isSameEntry: (a, b) => a.slug === b.slug,
  });

  const currentSlug = (): string | null => browser.current()?.slug ?? null;
  const currentDoc = (): Doc | null => {
    const slug = currentSlug();
    return slug !== null ? (docs[slug] ?? null) : null;
  };

  return {
    currentDoc,
    currentSlug,
    open: (slug) => browser.navigate({ slug }),
    back: () => void browser.back(),
    forward: () => void browser.forward(),
    canBack: browser.canBack,
    canForward: browser.canForward,
  };
}
