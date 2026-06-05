import type { Doc } from "../docsite";

/** The doc set this host browses — a mini handbook *about* @kolu/solid-browser,
 *  so reading it through the viewer both demonstrates and explains the package.
 *  This map is exactly the volatility this host injects: kolu injects "git repo
 *  + mode → file"; here it's "slug → page". The history controller behind the
 *  ◀ ▶ buttons is identical in both. */
export const HOME = "index";

export const DOCS: Record<string, Doc> = {
  index: {
    title: "Welcome",
    body: [
      "This little site is a doc browser. Click a page in the sidebar, or follow a 'Read next' link below — then use the ◀ and ▶ buttons up top to retrace your steps, exactly like a web browser.",
      "It exists to prove one claim: the back/forward behaviour you're using right now is NOT written here. It's @kolu/solid-browser's createBrowser, dropped in unchanged. This whole app is the second host plugging into it.",
    ].join("\n\n"),
    links: ["concept", "history"],
  },
  concept: {
    title: "The browser is the electricity",
    body: [
      "kolu's Code tab is a browser wearing git as a costume: render a space of interlinked documents, follow links between them, go back and forward. Strip git off and what remains — locations, links, history — is a general capability.",
      "createBrowser is that capability, as a reactive controller over an opaque location type. It knows nothing about git, files, or even what a 'page' is. A host injects its own location type and its own way of resolving one; the controller just stores, compares, and replays them.",
    ].join("\n\n"),
    links: ["history", "api"],
  },
  history: {
    title: "Back & forward, for free",
    body: [
      "A browser has history the way a heart has chambers. Once every navigation routes through one front door, back/forward fall out: a stack of visited locations plus a cursor into it.",
      "The one non-obvious rule is forward-truncation — navigating after going back forks history, discarding the entries you could have gone forward to. Try it: go back a couple of pages, then click a sidebar page; the ▶ button goes dark.",
    ].join("\n\n"),
    links: ["api", "concept"],
  },
  api: {
    title: "The createBrowser API",
    body: [
      "createBrowser<L>() returns current(), canBack(), canForward(), navigate(loc), back(), and forward() — all reactive. This host wraps them as open()/back()/forward() and resolves the current location's slug through its own page map.",
      "That's the entire integration: ~40 lines in docsite.ts. The back/forward feature is the injected controller, untouched. Swap this page map for kolu's git resolver and the same browser reads a repo.",
    ].join("\n\n"),
    links: ["faq", "index"],
  },
  faq: {
    title: "FAQ",
    body: [
      "Q: Is this kolu? — No. There's no git here, no FileData, no kolu code at all. The only shared piece is @kolu/solid-browser.",
      "Q: Why does this prove anything? — A package that claims to be reusable should have a second, unrelated consumer actually using it. You're looking at one.",
    ].join("\n\n"),
    links: ["index", "concept"],
  },
};
