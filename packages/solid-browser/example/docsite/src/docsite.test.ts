import { flush } from "solid-js";
import { describe, expect, it } from "vitest";
import { type Doc, createDocSite } from "./docsite";

const DOCS: Record<string, Doc> = {
  index: {
    title: "Home",
    body: "Welcome to the docs.",
    links: ["guide", "api"],
  },
  guide: { title: "Guide", body: "How to get started.", links: ["api"] },
  api: { title: "API", body: "The reference.", links: ["index"] },
};

// THE TWO CLOCKS. `open` / `back` / `forward` move the controller's plain
// stack and answer now; `currentDoc` / `currentSlug` / `canBack` /
// `canForward` read the reactive mirror, which a signal write reaches on the
// next flush. So every assertion on the mirror is taken after one. The seeded
// initial entry is the signals' creation value, so the first case needs none.
describe("doc-site — a second host reusing @kolu/solid-browser's createBrowser", () => {
  it("renders the seeded home doc with nowhere to go back to", () => {
    const site = createDocSite(DOCS, "index");
    expect(site.currentDoc()?.title).toBe("Home");
    expect(site.canBack()).toBe(false);
    expect(site.canForward()).toBe(false);
  });

  it("follows links and traverses back/forward through the visit history", () => {
    const site = createDocSite(DOCS, "index");
    site.open("guide");
    site.open("api");
    flush();
    expect(site.currentDoc()?.title).toBe("API");
    expect(site.canBack()).toBe(true);
    expect(site.canForward()).toBe(false);

    site.back();
    flush();
    expect(site.currentDoc()?.title).toBe("Guide");
    site.back();
    flush();
    expect(site.currentDoc()?.title).toBe("Home");

    site.forward();
    flush();
    expect(site.currentDoc()?.title).toBe("Guide");
    site.forward();
    flush();
    expect(site.currentDoc()?.title).toBe("API");
  });

  it("forks history when opening a new doc after going back", () => {
    const site = createDocSite(DOCS, "index");
    site.open("guide");
    site.open("api");
    site.back(); // at "guide", "api" ahead

    site.open("index"); // forks — the forward "api" is discarded
    flush();
    expect(site.currentSlug()).toBe("index");
    expect(site.canForward()).toBe(false);

    site.back();
    flush();
    expect(site.currentSlug()).toBe("guide");
  });

  it("re-opening the current doc does not deepen history (isSameEntry)", () => {
    const site = createDocSite(DOCS, "index");
    site.open("guide");
    site.open("guide"); // same slug — no new entry
    site.back();
    flush();
    expect(site.currentSlug()).toBe("index");
    expect(site.canBack()).toBe(false);
  });
});
