import { type Browser, createBrowser } from "@kolu/solid-browser";

export type DocLocation = { slug: string };

export type Doc = { title: string; body: string; links: string[] };

export type DocSite = {
  currentDoc: () => Doc | null;
  currentSlug: () => string | null;
  open: (slug: string) => void;
  back: () => void;
  forward: () => void;
  canBack: () => boolean;
  canForward: () => boolean;
};

export function createDocSite(
  docs: Record<string, Doc>,
  home: string,
): DocSite {
  const browser: Browser<DocLocation> = createBrowser<DocLocation>({
    initial: { slug: home },
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
