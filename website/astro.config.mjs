// @ts-check

import { existsSync, readFileSync } from "node:fs";
import mdx from "@astrojs/mdx";
import sitemap from "@astrojs/sitemap";
import starlight from "@astrojs/starlight";
import tailwindcss from "@tailwindcss/vite";
import { defineConfig } from "astro/config";

function readKoluVersion() {
  if (process.env.KOLU_VERSION) return process.env.KOLU_VERSION;

  const candidates = [
    new URL("../packages/server/package.json", import.meta.url),
    new URL("./kolu-server-package.json", import.meta.url),
  ];
  const file = candidates.find((url) => existsSync(url));
  if (!file) {
    throw new Error(
      "Kolu server package.json is required for the website build",
    );
  }
  const pkg = JSON.parse(readFileSync(file, "utf8"));
  if (typeof pkg.version !== "string" || pkg.version.length === 0) {
    throw new Error("packages/server/package.json is missing a string version");
  }
  return pkg.version;
}

// https://astro.build/config
// Port pinned to 4321 (Astro default) — kept explicit to make clear it
// never collides with Kolu's default 7681.
const DEV_PORT = 4321;
const KOLU_VERSION = readKoluVersion();
process.env.PUBLIC_KOLU_VERSION = KOLU_VERSION;

export default defineConfig({
  site: "https://kolu.dev",
  trailingSlash: "ignore",
  server: { port: DEV_PORT, host: "127.0.0.1" },
  // /tui is the page's old name (from before the daemon `kaval` and its client
  // `kaval-tui` were named apart) — keep the URL working, send it to /kaval.
  redirects: { "/tui": "/kaval" },
  integrations: [
    // Starlight docs system, mounted at the site ROOT: it routes
    // src/content/docs/<slug>.mdx to /<slug>, so padi/kaval/architecture keep
    // their pre-Starlight URLs by construction (no /docs prefix, no redirects).
    // The existing src/pages routes (/, /blog, /changelog, /open-graph)
    // coexist as file-based pages — only the three migrated .astro pages were
    // deleted to avoid a route collision.
    starlight({
      title: "Kolu",
      // Theme Starlight with the site's own palette + fonts (accent = the kolu
      // primary). global.css carries the --color-kolu-* / --color-ink / etc.
      // tokens the migrated diagrams reference; starlight.css maps Starlight's
      // --sl-* variables onto them and styles the ported figures.
      customCss: ["./src/styles/starlight.css"],
      // Component overrides that make the docs wear kolu.dev's design language:
      //  - Header: the site's own top bar (shared <NavBar />), so the landing
      //    pages and docs share ONE header.
      //  - PageTitle: the bespoke hero (eyebrow · accent-word headline · product
      //    mark) from frontmatter, with a kolu-styled fallback for plain docs.
      //  - ThemeProvider: dark by default, matching the rest of the site.
      // The rest of the kolu look (dotted-grid dark background, accent-bar
      // section headings, dark cards/asides, site typography) is the customCss
      // layer above — so a new .md inherits the theme with no per-page work.
      components: {
        Header: "./src/components/StarlightHeader.astro",
        PageTitle: "./src/components/KoluHero.astro",
        ThemeProvider: "./src/components/KoluThemeProvider.astro",
        // Drop Starlight's own theme <select>: the shared NavBar carries the one
        // toggle, and the stock select's on-load script stores "auto" and forces
        // the OS colour scheme, overriding our dark-by-default.
        ThemeSelect: "./src/components/Empty.astro",
      },
      social: [
        {
          icon: "github",
          label: "GitHub",
          href: "https://github.com/juspay/kolu",
        },
      ],
      // Starlight owns the light/dark switch on its pages via the same
      // data-theme attribute the rest of the site uses, so the toggle is
      // consistent across Starlight and file-based pages.
      sidebar: [
        {
          label: "Documentation",
          items: [
            { label: "Architecture", link: "/architecture" },
            { label: "Padi", link: "/padi" },
            { label: "Kaval", link: "/kaval" },
          ],
        },
      ],
    }),
    mdx(),
    // /kaval graduated — it's now a listed, indexable page. Only /tui stays out
    // of the sitemap: it's a redirect to /kaval, so advertising it would double
    // up the canonical URL.
    sitemap({
      filter: (page) => !new URL(page).pathname.startsWith("/tui"),
    }),
  ],
  vite: {
    plugins: [tailwindcss()],
    define: {
      "import.meta.env.PUBLIC_KOLU_VERSION": JSON.stringify(KOLU_VERSION),
    },
  },
  markdown: {
    shikiConfig: {
      // Dual theme — astro emits both as CSS variables; global.css routes
      // them via `[data-theme]` so code blocks track the light/dark toggle.
      themes: {
        light: "vitesse-light",
        dark: "vitesse-black",
      },
      defaultColor: false,
      wrap: false,
    },
  },
});
