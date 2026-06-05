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
    expect(site.currentDoc()?.title).toBe("API");
    expect(site.canBack()).toBe(true);
    expect(site.canForward()).toBe(false);

    site.back();
    expect(site.currentDoc()?.title).toBe("Guide");
    site.back();
    expect(site.currentDoc()?.title).toBe("Home");

    site.forward();
    expect(site.currentDoc()?.title).toBe("Guide");
    site.forward();
    expect(site.currentDoc()?.title).toBe("API");
  });

  it("forks history when opening a new doc after going back", () => {
    const site = createDocSite(DOCS, "index");
    site.open("guide");
    site.open("api");
    site.back(); // at "guide", "api" ahead

    site.open("index"); // forks — the forward "api" is discarded
    expect(site.currentSlug()).toBe("index");
    expect(site.canForward()).toBe(false);

    site.back();
    expect(site.currentSlug()).toBe("guide");
  });

  it("re-opening the current doc does not deepen history (isSameEntry)", () => {
    const site = createDocSite(DOCS, "index");
    site.open("guide");
    site.open("guide"); // same slug — no new entry
    site.back();
    expect(site.currentSlug()).toBe("index");
    expect(site.canBack()).toBe(false);
  });
});
